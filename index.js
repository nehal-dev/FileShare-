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
    limits: { fileSize: 300 * 1024 * 1024 }
});

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

const files = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/download/:fileId', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

app.post('/upload', upload.single('file'), (req, res) => {
    const fileId = path.parse(req.file.filename).name;
    files.set(fileId, {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        uploadDate: new Date(),
        path: req.file.path
    });
    res.json({ fileId });
});

app.get('/file-info/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (fileInfo) {
        res.json(fileInfo);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

app.get('/download-file/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (fileInfo) {
        res.download(fileInfo.path, fileInfo.fileName);
    } else {
        res.status(404).send('File not found');
    }
});

io.on('connection', socket => {
    console.log('Client connected');
    socket.on('disconnect', () => console.log('Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
