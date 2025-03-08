const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        cb(null, fileId + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 * 10 } // Increased to 10 GB
});

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads', { recursive: true });
}

if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp', { recursive: true });
}

const files = new Map();
const groupUploads = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/download/:groupId', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

app.post('/upload', upload.array('files', 50), (req, res) => {
    const groupId = crypto.randomBytes(8).toString('hex');
    const uploadedFiles = [];

    try {
        req.files.forEach(file => {
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
        });

        groupUploads.set(groupId, uploadedFiles);
        res.json({ groupId });
    } catch (error) {
        res.status(500).json({ error: 'File upload failed' });
    }
});

app.get('/group-info/:groupId', (req, res) => {
    const groupFiles = groupUploads.get(req.params.groupId);
    if (groupFiles) {
        res.json(groupFiles);
    } else {
        res.status(404).json({ error: 'Files not found' });
    }
});

app.get('/download-group/:groupId', (req, res) => {
    const groupFiles = groupUploads.get(req.params.groupId);
    if (!groupFiles) {
        return res.status(404).json({ error: 'Files not found' });
    }

    if (groupFiles.length === 1) {
        const fileInfo = groupFiles[0];
        fs.readFile(fileInfo.path, (err, data) => {
            if (err) {
                return res.status(500).json({ error: 'File not found' });
            }
            res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
            res.setHeader('Content-Type', fileInfo.mimeType);
            res.setHeader('Content-Length', data.length);
            res.send(data);
        });
        return;
    }

    const zipFileName = `VarMax_Files_${req.params.groupId}.zip`;
    const zipPath = path.join('./temp', zipFileName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        fs.readFile(zipPath, (err, data) => {
            if (err) {
                return res.status(500).json({ error: 'Error creating zip file' });
            }
            res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Length', data.length);
            res.send(data);
            fs.unlink(zipPath, () => {});
        });
    });

    archive.on('error', err => {
        res.status(500).json({ error: 'Error creating zip file' });
    });

    archive.pipe(output);

    groupFiles.forEach(fileInfo => {
        archive.file(fileInfo.path, { name: fileInfo.fileName });
    });

    archive.finalize();
});

app.get('/download-file/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (fileInfo) {
        fs.readFile(fileInfo.path, (err, data) => {
            if (err) {
                return res.status(404).json({ error: 'File not found' });
            }
            res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
            res.setHeader('Content-Type', fileInfo.mimeType);
            res.setHeader('Content-Length', data.length);
            res.send(data);
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

io.on('connection', socket => {
    socket.on('uploadProgress', data => {
        socket.broadcast.emit('fileProgress', data);
    });
});

setInterval(() => {
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const now = new Date();

    files.forEach((fileInfo, fileId) => {
        if (now - fileInfo.uploadDate > twentyFourHours) {
            fs.unlink(fileInfo.path, err => {
                if (!err) {
                    files.delete(fileId);
                }
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
