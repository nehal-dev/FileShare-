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
    limits: { fileSize: 1024 * 1024 * 1024 }
});

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp');
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
        return res.status(404).send('Files not found');
    }

    if (groupFiles.length === 1) {
        const fileInfo = groupFiles[0];
        return res.download(fileInfo.path, fileInfo.fileName);
    }

    const zipFileName = `VarMax_Files_${req.params.groupId}.zip`;
    const zipPath = path.join('./temp', zipFileName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        res.download(zipPath, zipFileName, () => {
            fs.unlink(zipPath, err => {
                if (err) console.error('Error deleting temp zip:', err);
            });
        });
    });

    archive.on('error', err => {
        res.status(500).send('Error creating zip file');
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
        res.download(fileInfo.path, fileInfo.fileName);
    } else {
        res.status(404).send('File not found');
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
