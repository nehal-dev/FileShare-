const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const compression = require('compression');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { pipeline } = require('stream');
const zlib = require('zlib');

app.use(compression({
    level: 6,
    threshold: 0
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        cb(null, `${fileId}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10737418240, // 10GB
        files: 100
    }
}).array('files', 100);

const files = new Map();
const groupUploads = new Map();
const activeDownloads = new Map();

if (cluster.isMaster) {
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.post('/upload', (req, res) => {
        upload(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            const groupId = crypto.randomBytes(8).toString('hex');
            const uploadedFiles = [];

            for (const file of req.files) {
                const fileId = path.parse(file.filename).name;
                const fileInfo = {
                    fileId,
                    fileName: file.originalname,
                    fileSize: file.size,
                    uploadDate: new Date(),
                    path: file.path,
                    mimeType: file.mimetype
                };
                files.set(fileId, fileInfo);
                uploadedFiles.push(fileInfo);
            }

            groupUploads.set(groupId, uploadedFiles);
            res.json({ groupId });
        });
    });

    app.get('/download/:groupId', (req, res) => {
        const groupFiles = groupUploads.get(req.params.groupId);
        if (!groupFiles) {
            return res.status(404).send('Files not found');
        }

        if (groupFiles.length === 1) {
            const fileInfo = groupFiles[0];
            const fileStream = fs.createReadStream(fileInfo.path);
            
            res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
            res.setHeader('Content-Type', fileInfo.mimeType);

            pipeline(fileStream, res, (err) => {
                if (err) {
                    console.error('Pipeline failed', err);
                }
            });
        } else {
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            res.setHeader('Content-Disposition', `attachment; filename="VarMax_Files_${req.params.groupId}.zip"`);
            res.setHeader('Content-Type', 'application/zip');

            archive.pipe(res);

            groupFiles.forEach(fileInfo => {
                archive.file(fileInfo.path, { name: fileInfo.fileName });
            });

            archive.finalize();
        }
    });

    io.on('connection', (socket) => {
        socket.on('uploadProgress', (data) => {
            socket.broadcast.emit('fileProgress', data);
        });
    });

    setInterval(() => {
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const now = new Date();

        files.forEach((fileInfo, fileId) => {
            if (now - fileInfo.uploadDate > twentyFourHours) {
                fs.unlink(fileInfo.path, () => {
                    files.delete(fileId);
                });
            }
        });

        groupUploads.forEach((groupFiles, groupId) => {
            if (now - groupFiles[0].uploadDate > twentyFourHours) {
                groupUploads.delete(groupId);
            }
        });
    }, 60 * 60 * 1000);

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`Worker ${process.pid} started on port ${PORT}`));
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
