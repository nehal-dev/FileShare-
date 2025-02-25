<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Varmax File Share</title>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', sans-serif;
        }

        body {
            background: #1a1a1a;
            color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            position: relative;
        }

        .container {
            max-width: 500px;
            width: 100%;
            background: #2d2d2d;
            border-radius: 15px;
            padding: 30px;
            margin-top: 50px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
        }

        h1 {
            text-align: center;
            margin-bottom: 30px;
            color: #4CAF50;
        }

        .drop-zone {
            border: 2px dashed #4CAF50;
            border-radius: 10px;
            padding: 30px;
            text-align: center;
            transition: all 0.3s ease;
            position: relative;
            min-height: 200px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }

        .drop-zone:hover {
            background: rgba(76, 175, 80, 0.1);
        }

        .drop-zone.dragging {
            background: rgba(76, 175, 80, 0.2);
            border-color: #69f0ae;
        }

        .icon {
            font-size: 50px;
            color: #4CAF50;
            margin-bottom: 15px;
        }

        .browse-button {
            background: #4CAF50;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            margin-top: 15px;
            cursor: pointer;
            display: inline-block;
            transition: background 0.3s ease;
        }

        .browse-button:hover {
            background: #45a049;
        }

        .progress-container {
            display: none;
            margin-top: 20px;
            width: 100%;
        }

        .progress-bar {
            width: 100%;
            height: 10px;
            background: #404040;
            border-radius: 5px;
            overflow: hidden;
        }

        .progress {
            width: 0%;
            height: 100%;
            background: #4CAF50;
            transition: width 0.2s ease;
        }

        .url-container {
            display: none;
            margin-top: 20px;
            background: #404040;
            padding: 15px;
            border-radius: 8px;
            position: relative;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .url-container.show {
            opacity: 1;
        }

        .url-input {
            width: 100%;
            background: transparent;
            border: none;
            color: #fff;
            padding: 5px;
            padding-right: 40px;
            outline: none;
            font-size: 14px;
        }

        .copy-btn {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: #4CAF50;
            cursor: pointer;
            padding: 5px;
            transition: color 0.3s ease;
        }

        .copy-btn:hover {
            color: #69f0ae;
        }

        .footer {
            position: fixed;
            bottom: 10px;
            color: #666;
            font-size: 12px;
            text-align: center;
        }

        @media (max-width: 480px) {
            .container {
                padding: 20px;
                margin-top: 20px;
            }

            .drop-zone {
                padding: 20px;
                min-height: 150px;
            }

            .icon {
                font-size: 40px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Varmax File Share</h1>
        <div class="drop-zone" id="dropZone">
            <span class="material-icons icon">cloud_upload</span>
            <p>Drag & Drop your file here</p>
            <div class="browse-button" id="browseButton">or Click to Browse</div>
            <input type="file" id="fileInput" style="display: none;">
        </div>
        <div class="progress-container" id="progressContainer">
            <div class="progress-bar">
                <div class="progress" id="progressBar"></div>
            </div>
        </div>
        <div class="url-container" id="urlContainer">
            <input type="text" class="url-input" id="urlInput" readonly>
            <button class="copy-btn material-icons" id="copyBtn">content_copy</button>
        </div>
    </div>
    <div class="footer">Made By NZ R</div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const browseButton = document.getElementById('browseButton');
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const urlContainer = document.getElementById('urlContainer');
        const urlInput = document.getElementById('urlInput');
        const copyBtn = document.getElementById('copyBtn');

        browseButton.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragging');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragging');
            handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

        function handleFile(file) {
            if (!file) return;
            if (file.size > 300 * 1024 * 1024) {
                alert('File size must be less than 300MB');
                return;
            }

            progressContainer.style.display = 'block';
            urlContainer.style.display = 'none';
            progressBar.style.width = '0%';

            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/upload', true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const progress = (e.loaded / e.total) * 100;
                    progressBar.style.width = `${progress}%`;
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    setTimeout(() => {
                        urlContainer.style.display = 'block';
                        urlInput.value = `${window.location.origin}/download/${response.fileId}`;
                        requestAnimationFrame(() => urlContainer.classList.add('show'));
                    }, 500);
                } else {
                    alert('Upload failed. Please try again.');
                }
            };

            xhr.onerror = () => alert('Upload failed. Please try again.');
            xhr.send(formData);
        }

        copyBtn.addEventListener('click', () => {
            urlInput.select();
            document.execCommand('copy');
            copyBtn.textContent = 'check';
            setTimeout(() => copyBtn.textContent = 'content_copy', 2000);
        });
    </script>
</body>
</html>
