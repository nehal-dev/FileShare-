const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const mime = require('mime-types');

// Enhanced storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fsSync.existsSync(uploadDir)) {
            fsSync.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${fileId}${ext}`);
    }
});

// Enhanced upload configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024 * 10, // 10GB
        files: 50
    },
    fileFilter: (req, file, cb) => {
        // Add file type validation if needed
        cb(null, true);
    }
});

// Initialize required directories
const initDirectories = async () => {
    const dirs = ['./uploads', './temp'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            console.error(`Error creating directory ${dir}:`, error);
        }
    }
};

initDirectories();

// In-memory storage
const files = new Map();
const groupUploads = new Map();

// Utility functions
const generateUniqueId = () => crypto.randomBytes(8).toString('hex');
const calculateHash = async (filePath) => {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

// Route handlers
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/download/:groupId', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

// Enhanced upload handler
app.post('/upload', upload.array('files', 50), async (req, res) => {
    try {
        const groupId = generateUniqueId();
        const uploadedFiles = await Promise.all(req.files.map(async file => ({
            fileId: path.parse(file.filename).name,
            fileName: file.originalname,
            fileSize: file.size,
            uploadDate: new Date(),
            path: file.path,
            mimeType: file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream',
            hash: await calculateHash(file.path)
        })));

        groupUploads.set(groupId, uploadedFiles);
        uploadedFiles.forEach(file => files.set(file.fileId, file));

        res.json({
            groupId,
            filesCount: uploadedFiles.length,
            totalSize: uploadedFiles.reduce((acc, file) => acc + file.fileSize, 0),
            files: uploadedFiles.map(file => ({
                name: file.fileName,
                size: file.fileSize,
                type: file.mimeType
            }))
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Enhanced group info endpoint
app.get('/group-info/:groupId', (req, res) => {
    const groupFiles = groupUploads.get(req.params.groupId);
    if (!groupFiles) {
        return res.status(404).json({ error: 'Files not found' });
    }

    res.json({
        groupId: req.params.groupId,
        filesCount: groupFiles.length,
        totalSize: groupFiles.reduce((acc, file) => acc + file.fileSize, 0),
        files: groupFiles.map(file => ({
            name: file.fileName,
            size: file.fileSize,
            type: file.mimeType,
            uploadDate: file.uploadDate
        }))
    });
});

// Enhanced download handler
app.get('/download-group/:groupId', async (req, res) => {
    try {
        const groupFiles = groupUploads.get(req.params.groupId);
        if (!groupFiles) {
            return res.status(404).json({ error: 'Files not found' });
        }

        // Single file download
        if (groupFiles.length === 1) {
            const fileInfo = groupFiles[0];
            const fileStream = fsSync.createReadStream(fileInfo.path);
            
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.fileName)}"`);
            res.setHeader('Content-Type', fileInfo.mimeType);
            res.setHeader('Content-Length', fileInfo.fileSize);

            let downloaded = 0;
            fileStream.on('data', chunk => {
                downloaded += chunk.length;
                const percentage = Math.round((downloaded / fileInfo.fileSize) * 100);
                io.emit('downloadProgress', {
                    groupId: req.params.groupId,
                    percentage,
                    fileName: fileInfo.fileName
                });
            });

            fileStream.pipe(res);
            return;
        }

        // Multiple files download (ZIP)
        const zipFileName = `VarMax_Files_${req.params.groupId}_${new Date().toISOString().slice(0,10)}.zip`;
        const zipPath = path.join('./temp', zipFileName);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 },
            comment: `Created by VarMax on ${new Date().toISOString()}`
        });

        const totalSize = groupFiles.reduce((acc, file) => acc + file.fileSize, 0);
        let processedSize = 0;

        archive.on('data', chunk => {
            processedSize += chunk.length;
            const percentage = Math.round((processedSize / totalSize) * 100);
            io.emit('downloadProgress', {
                groupId: req.params.groupId,
                percentage,
                totalFiles: groupFiles.length
            });
        });

        output.on('close', () => {
            const zipStats = fsSync.statSync(zipPath);
            const fileStream = fsSync.createReadStream(zipPath);
            
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Length', zipStats.size);

            fileStream.pipe(res);
            fileStream.on('end', async () => {
                try {
                    await fs.unlink(zipPath);
                } catch (error) {
                    console.error('Error deleting temp zip file:', error);
                }
            });
        });

        archive.on('error', err => {
            console.error('Archive error:', err);
            res.status(500).json({ error: 'Error creating zip file' });
        });

        archive.pipe(output);

        // Add files to archive with proper directory structure
        for (const fileInfo of groupFiles) {
            try {
                if (await fs.access(fileInfo.path).then(() => true).catch(() => false)) {
                    archive.file(fileInfo.path, { name: fileInfo.fileName });
                }
            } catch (error) {
                console.error(`Error adding file to archive: ${fileInfo.fileName}`, error);
            }
        }

        await archive.finalize();
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Cleanup job
const cleanup = async () => {
    try {
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const now = new Date();

        // Clean up files
        for (const [fileId, fileInfo] of files) {
            if (now - fileInfo.uploadDate > twentyFourHours) {
                try {
                    await fs.unlink(fileInfo.path);
                    files.delete(fileId);
                } catch (error) {
                    console.error(`Error deleting file ${fileId}:`, error);
                }
            }
        }

        // Clean up groups
        for (const [groupId, groupFiles] of groupUploads) {
            if (now - groupFiles[0].uploadDate > twentyFourHours) {
                groupUploads.delete(groupId);
            }
        }

        // Clean up temp directory
        const tempFiles = await fs.readdir('./temp');
        for (const file of tempFiles) {
            const filePath = path.join('./temp', file);
            const stats = await fs.stat(filePath);
            if (now - stats.mtime > 3600000) { // 1 hour
                await fs.unlink(filePath);
            }
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
};

setInterval(cleanup, 60 * 60 * 1000); // Run cleanup every hour

// Socket.IO connection handling
io.on('connection', socket => {
    socket.on('error', error => {
        console.error('Socket.IO error:', error);
    });
});

// Error handling
process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Maximum file size: ${(upload.limits.fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB`);
    console.log(`Maximum files per upload: ${upload.limits.files}`);
});
