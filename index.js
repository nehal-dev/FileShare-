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
const stream = require('stream');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');

app.use(compression({
    level: 9,
    threshold: 0
}));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

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
        fileSize: 10 * 1024 * 1024 * 1024, // 10GB limit
        files: 100
    },
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
}).array('files', 100);

const files = new Map();
const groupUploads = new Map();
const activeDownloads = new Map();
const uploadSpeeds = new Map();

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

    app.post('/upload', async (req, res) => {
        try {
            upload(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ error: err.message });
                }

                const groupId = crypto.randomBytes(8).toString('hex');
                const uploadedFiles = [];
                const startTime = Date.now();

                for (const file of req.files) {
                    const fileId = path.parse(file.filename).name;
                    const fileInfo = {
                        fileId,
                        fileName: file.originalname,
                        fileSize: file.size,
                        uploadDate: new Date(),
                        path: file.path,
                        mimeType: file.mimetype,
                        checksum: await calculateChecksum(file.path)
                    };
                    files.set(fileId, fileInfo);
                    uploadedFiles.push(fileInfo);

                    const uploadSpeed = file.size / ((Date.now() - startTime) / 1000);
                    uploadSpeeds.set(fileId, uploadSpeed);
                }

                groupUploads.set(groupId, uploadedFiles);
                res.json({ 
                    groupId,
                    uploadSpeed: calculateAverageSpeed(uploadedFiles.map(f => f.fileId))
                });
            });
        } catch (error) {
            res.status(500).json({ error: 'Upload failed' });
        }
    });

    app.get('/download/:groupId', async (req, res) => {
        try {
            const groupFiles = groupUploads.get(req.params.groupId);
            if (!groupFiles) {
                return res.status(404).send('Files not found');
            }

            const startTime = Date.now();
            activeDownloads.set(req.params.groupId, startTime);

            if (groupFiles.length === 1) {
                const fileInfo = groupFiles[0];
                const fileStream = fs.createReadStream(fileInfo.path);
                const compressionStream = zlib.createGzip({ level: 9 });

                res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
                res.setHeader('Content-Type', fileInfo.mimeType);
                res.setHeader('Transfer-Encoding', 'chunked');

                await pipeline(fileStream, compressionStream, res);
            } else {
                const zipFileName = `VarMax_Files_${req.params.groupId}.zip`;
                const archive = archiver('zip', {
                    zlib: { level: 9 },
                    store: false
                });

                res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Transfer-Encoding', 'chunked');

                archive.pipe(res);

                for (const fileInfo of groupFiles) {
                    archive.file(fileInfo.path, { name: fileInfo.fileName });
                }

                await archive.finalize();
            }

            const endTime = Date.now();
            const downloadSpeed = calculateDownloadSpeed(req.params.groupId, startTime, endTime);
            io.emit('downloadSpeed', { groupId: req.params.groupId, speed: downloadSpeed });

        } catch (error) {
            res.status(500).send('Download failed');
        } finally {
            activeDownloads.delete(req.params.groupId);
        }
    });

    app.get('/status/:groupId', (req, res) => {
        const groupFiles = groupUploads.get(req.params.groupId);
        if (groupFiles) {
            const totalSize = groupFiles.reduce((sum, file) => sum + file.fileSize, 0);
            const isDownloading = activeDownloads.has(req.params.groupId);
            res.json({
                status: 'active',
                files: groupFiles.length,
                totalSize,
                isDownloading
            });
        } else {
            res.status(404).json({ status: 'not found' });
        }
    });

    io.on('connection', (socket) => {
        socket.on('uploadProgress', (data) => {
            socket.broadcast.emit('fileProgress', data);
        });

        socket.on('downloadStart', (data) => {
            activeDownloads.set(data.groupId, Date.now());
        });
    });

    const cleanupInterval = setInterval(() => {
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const now = new Date();

        files.forEach((fileInfo, fileId) => {
            if (now - fileInfo.uploadDate > twentyFourHours) {
                fs.unlink(fileInfo.path, () => {
                    files.delete(fileId);
                    uploadSpeeds.delete(fileId);
                });
            }
        });

        groupUploads.forEach((groupFiles, groupId) => {
            if (now - groupFiles[0].uploadDate > twentyFourHours) {
                groupUploads.delete(groupId);
            }
        });
    }, 30 * 60 * 1000);

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`Worker ${process.pid} started on port ${PORT}`));
}

async function calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function calculateAverageSpeed(fileIds) {
    const speeds = fileIds.map(id => uploadSpeeds.get(id)).filter(Boolean);
    return speeds.length ? speeds.reduce((a, b) => a + b) / speeds.length : 0;
}

function calculateDownloadSpeed(groupId, startTime, endTime) {
    const groupFiles = groupUploads.get(groupId);
    if (!groupFiles) return 0;
    
    const totalSize = groupFiles.reduce((sum, file) => sum + file.fileSize, 0);
    const duration = (endTime - startTime) / 1000;
    return totalSize / duration;
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
