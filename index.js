const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mime = require('mime-types');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        cb(null, fileId + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 * 10 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image', 'video', 'audio', 'application'];
        const fileType = mime.lookup(file.originalname).split('/')[0];
        if (allowedTypes.includes(fileType)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads', { recursive: true });
}

if (!fs.existsSync('./thumbnails')) {
    fs.mkdirSync('./thumbnails', { recursive: true });
}

const files = new Map();
const groupUploads = new Map();
const thumbnails = new Map();

async function generateThumbnail(file) {
    const thumbnailPath = path.join('./thumbnails', `${path.parse(file.filename).name}.jpg`);
    
    if (file.mimetype.startsWith('image/')) {
        await sharp(file.path)
            .resize(300, 300, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);
        return thumbnailPath;
    } 
    else if (file.mimetype.startsWith('video/')) {
        return new Promise((resolve, reject) => {
            ffmpeg(file.path)
                .screenshots({
                    timestamps: ['00:00:01'],
                    filename: `${path.parse(file.filename).name}.jpg`,
                    folder: './thumbnails',
                    size: '300x300'
                })
                .on('end', () => resolve(thumbnailPath))
                .on('error', (err) => reject(err));
        });
    }
    return null;
}

app.use(express.static('public'));
app.use('/thumbnails', express.static('thumbnails'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/download/:groupId', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

app.post('/upload', upload.array('files', 50), async (req, res) => {
    try {
        const groupId = crypto.randomBytes(8).toString('hex');
        const uploadedFiles = [];

        for (const file of req.files) {
            const thumbnailPath = await generateThumbnail(file);
            const fileInfo = {
                fileId: path.parse(file.filename).name,
                fileName: file.originalname,
                fileSize: file.size,
                uploadDate: new Date(),
                path: file.path,
                mimeType: file.mimetype,
                thumbnailPath: thumbnailPath
            };
            uploadedFiles.push(fileInfo);
            files.set(fileInfo.fileId, fileInfo);
            if (thumbnailPath) {
                thumbnails.set(fileInfo.fileId, thumbnailPath);
            }
        }

        groupUploads.set(groupId, uploadedFiles);
        res.json({ groupId });
    } catch (error) {
        res.status(500).json({ error: 'Upload failed' });
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

app.get('/preview/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (!fileInfo) {
        return res.status(404).send('File not found');
    }

    const thumbnailPath = thumbnails.get(req.params.fileId);
    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        res.sendFile(path.resolve(thumbnailPath));
    } else {
        res.sendFile(path.resolve(fileInfo.path));
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

app.get('/stream/:fileId', (req, res) => {
    const fileInfo = files.get(req.params.fileId);
    if (!fileInfo) {
        return res.status(404).json({ error: 'File not found' });
    }

    if (!fileInfo.mimeType.startsWith('video/')) {
        return res.status(400).json({ error: 'Not a video file' });
    }

    const range = req.headers.range;
    if (!range) {
        return res.status(400).json({ error: 'Range header required' });
    }

    const videoSize = fs.statSync(fileInfo.path).size;
    const CHUNK_SIZE = 10 ** 6;
    const start = Number(range.replace(/\D/g, ''));
    const end = Math.min(start + CHUNK_SIZE, videoSize - 1);

    const contentLength = end - start + 1;
    const headers = {
        'Content-Range': `bytes ${start}-${end}/${videoSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength,
        'Content-Type': fileInfo.mimeType,
    };

    res.writeHead(206, headers);
    const videoStream = fs.createReadStream(fileInfo.path, { start, end });
    videoStream.pipe(res);
});

const cleanupFiles = () => {
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const now = new Date();

    files.forEach((fileInfo, fileId) => {
        if (now - fileInfo.uploadDate > twentyFourHours) {
            if (fs.existsSync(fileInfo.path)) {
                fs.unlinkSync(fileInfo.path);
            }
            if (fileInfo.thumbnailPath && fs.existsSync(fileInfo.thumbnailPath)) {
                fs.unlinkSync(fileInfo.thumbnailPath);
            }
            files.delete(fileId);
            thumbnails.delete(fileId);
        }
    });

    groupUploads.forEach((groupFiles, groupId) => {
        if (now - groupFiles[0].uploadDate > twentyFourHours) {
            groupUploads.delete(groupId);
        }
    });
};

setInterval(cleanupFiles, 60 * 60 * 1000);

process.on('SIGINT', () => {
    cleanupFiles();
    process.exit();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

io.on('connection', (socket) => {
    socket.on('disconnect', () => {});
});
