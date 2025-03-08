const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        cb(null, fileId + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 * 10 }
});

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads', { recursive: true });
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
    const uploadedFiles = req.files.map(file => ({
        fileId: path.parse(file.filename).name,
        fileName: file.originalname,
        fileSize: file.size,
        uploadDate: new Date(),
        path: file.path,
        mimeType: file.mimetype
    }));

    groupUploads.set(groupId, uploadedFiles);
    uploadedFiles.forEach(file => files.set(file.fileId, file));
    res.json({ groupId });
});

app.get('/group-info/:groupId', (req, res) => {
    const groupFiles = groupUploads.get(req.params.groupId);
    if (groupFiles) {
        res.json(groupFiles);
    } else {
        res.status(404).json({ error: 'Files not found' });
    }
});

app.get('/download-file/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (!fileInfo) {
        return res.status(404).json({ error: 'File not found' });
    }

    const fileStream = fs.createReadStream(fileInfo.path);
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
    res.setHeader('Content-Type', fileInfo.mimeType);

    let downloaded = 0;
    fileStream.on('data', chunk => {
        downloaded += chunk.length;
        const percentage = (downloaded / fileInfo.fileSize) * 100;
        io.emit('fileProgress', { fileId: req.params.fileId, percentage });
    });

    fileStream.pipe(res);
});

setInterval(() => {
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const now = new Date();

    files.forEach((fileInfo, fileId) => {
        if (now - fileInfo.uploadDate > twentyFourHours) {
            fs.unlink(fileInfo.path, () => files.delete(fileId));
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
