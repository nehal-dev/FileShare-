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
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|mov/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) cb(null, true);
        else cb('Error: Images and Videos Only!');
    }
});

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
if (!fs.existsSync('./archives')) fs.mkdirSync('./archives');

const files = new Map();
const bundles = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/download/:bundleId', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

app.post('/upload', upload.array('files', 10), (req, res) => {
    const bundleId = crypto.randomBytes(8).toString('hex');
    const fileList = req.files.map(file => ({
        fileName: file.originalname,
        fileSize: file.size,
        uploadDate: new Date(),
        path: file.path,
        type: file.mimetype.startsWith('image/') ? 'image' : 'video'
    }));
    
    bundles.set(bundleId, fileList);
    res.json({ bundleId });
});

app.get('/bundle-info/:bundleId', (req, res) => {
    const bundleInfo = bundles.get(req.params.bundleId);
    if (bundleInfo) {
        res.json(bundleInfo);
    } else {
        res.status(404).json({ error: 'Bundle not found' });
    }
});

app.get('/download-bundle/:bundleId', (req, res) => {
    const bundleInfo = bundles.get(req.params.bundleId);
    if (!bundleInfo) {
        return res.status(404).send('Bundle not found');
    }

    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    const archivePath = path.join(__dirname, 'archives', `${req.params.bundleId}.zip`);
    const output = fs.createWriteStream(archivePath);

    output.on('close', () => {
        res.download(archivePath, 'files.zip', () => {
            fs.unlink(archivePath, err => {
                if (err) console.error('Error deleting archive:', err);
            });
        });
    });

    archive.on('error', err => {
        res.status(500).send('Error creating archive');
    });

    archive.pipe(output);

    bundleInfo.forEach(file => {
        archive.file(file.path, { name: file.fileName });
    });

    archive.finalize();
});

app.get('/preview/:bundleId/:index', (req, res) => {
    const bundleInfo = bundles.get(req.params.bundleId);
    if (!bundleInfo || !bundleInfo[req.params.index]) {
        return res.status(404).send('File not found');
    }
    const file = bundleInfo[req.params.index];
    res.sendFile(path.resolve(file.path));
});

const cleanupUploads = () => {
    const maxAge = 24 * 60 * 60 * 1000;
    bundles.forEach((files, bundleId) => {
        const oldestFile = files.reduce((oldest, file) => 
            file.uploadDate < oldest ? file.uploadDate : oldest, 
            new Date()
        );
        
        if (Date.now() - oldestFile.getTime() > maxAge) {
            files.forEach(file => {
                fs.unlink(file.path, err => {
                    if (err) console.error('Error deleting file:', err);
                });
            });
            bundles.delete(bundleId);
        }
    });
};

setInterval(cleanupUploads, 60 * 60 * 1000);

io.on('connection', socket => {
    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
