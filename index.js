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
    limits: { fileSize: 1024 * 1024 * 1024 * 10 }
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

app.get('/download/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (fileInfo) {
        const fileStream = fs.createReadStream(fileInfo.path);
        res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
        res.setHeader('Content-Type', fileInfo.mimeType);
        fileStream.pipe(res);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

app.get('/download-group/:groupId', (req, res) => {
    const groupFiles = groupUploads.get(req.params.groupId);
    if (!groupFiles) {
        return res.status(404).json({ error: 'Files not found' });
    }

    if (groupFiles.length === 1) {
        const fileInfo = groupFiles[0];
        const fileStream = fs.createReadStream(fileInfo.path);
        res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
        res.setHeader('Content-Type', fileInfo.mimeType);
        fileStream.pipe(res);
        return;
    }

    const zipFileName = `VarMax_Files_${req.params.groupId}.zip`;
    const zipPath = path.join('./temp', zipFileName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    let totalSize = groupFiles.reduce((acc, file) => acc + file.fileSize, 0);
    let processedSize = 0;

    archive.on('data', chunk => {
        processedSize += chunk.length;
        const percentage = (processedSize / totalSize) * 100;
        io.emit('downloadProgress', { groupId: req.params.groupId, percentage });
    });

    output.on('close', () => {
        const fileStream = fs.createReadStream(zipPath);
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
        res.setHeader('Content-Type', 'application/zip');
        fileStream.pipe(res);
        fileStream.on('end', () => fs.unlink(zipPath, () => {}));
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
