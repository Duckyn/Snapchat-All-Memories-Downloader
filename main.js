// IMPORTS (no external packages needed)
const https = require('https');
const fs = require('fs');
const Queue = require("./concurrency.js")
const Progress = require("./progress.js")
const moment = require('moment');
const utimes = require('utimes').utimes;

// CONFIG
const dir = "Downloads";
const progressBarLength = 20;

concurrentIndex = process.argv.indexOf('-c');
const maxConcurrentDownloads = (concurrentIndex > -1) ? process.argv[concurrentIndex + 1] : 30;

filenameIndex = process.argv.indexOf('-f');
const jsonFile = (filenameIndex > -1) ? process.argv[filenameIndex + 1] : "./json/memories_history.json";

// INIT
var downloads = require(jsonFile)["Saved Media"];
var queue = new Queue(maxConcurrentDownloads);
var progress = new Progress(downloads.length, progressBarLength);

function main() {

    // Create download directory
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    // Start downloads
    for (let i = 0; i < downloads.length; i++) {

        let [url, body] = downloads[i]["Download Link"].split('?', 2);
        const fileTime = moment.utc(downloads[i]["Date"], "YYYY-MM-DD HH:mm:ss Z")
        let fileName = getFileName(downloads[i], fileTime);

        // First get CDN download link
        queue.enqueue(() => getDownloadLink(url, body, fileName, fileTime))
            .then((result) => {
                progress.cdnLinkSucceeded(true);

                // Download the file
                queue.enqueue(() => downloadMemory(result[0], result[1], result[2]))
                    .then((success) => {
                        progress.downloadSucceeded(true);
                    })
                    .catch((err) => {
                        progress.downloadSucceeded(false);
                    })
            })
            .catch((err) => {
                progress.cdnLinkSucceeded(false);
            })
    }
}

function getFileName(download, fileTime) {
    var filename = fileTime.format("YYYY-MM-DD_HH-mm-ss")

    if (download["Media Type"] == "Image")
        filename += ".jpg";
    else if (download["Media Type"] == "Video")
        filename += ".mp4";

    return filename
}

const getDownloadLink = (url, body, filename, fileTime) => new Promise(resolve => {
    var parsedUrl = new URL(url);

    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: "POST",
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    };

    var req = https.request(options, (res) => {

        data = "";
        res.on("data", (chunk) => {
            data += chunk;
        });
        res.on("error", function () {
            reject("request error");
        })
        res.on("end", function () {
            if (res.statusCode == 200) {
                resolve([data, filename, fileTime]);
            }
            else {
                reject("status error");
            }
        });
    });
    req.write(body);
    req.end();
});


const downloadMemory = (downloadUrl, filename, fileTime) => new Promise(resolve => {

    // Check if there already exists a file with the same name/timestamp
    if (fs.existsSync(dir + "/" + filename)) {
        duplicates = 1;
        while (true) {
            var extensionPos = filename.lastIndexOf('.');
            var newFilename = filename.substring(0, extensionPos) + " (" + duplicates + ")" + filename.substring(extensionPos, filename.length);
            if (fs.existsSync(dir + "/" + newFilename))
                duplicates++;
            else {
                filename = newFilename;
                break;
            }
        }
    }

    // Create the file and write to it
    var file = fs.createWriteStream(dir + "/" + filename);

    https.get(downloadUrl, function (res) {
        res.pipe(file);
        res.on("error", function () {
            reject("request error");
        })
        res.on("end", function () {
            file.close();
            if (res.statusCode == 200) {
                // Update the file creation date
                utimes(file.path, {
                    btime: fileTime.valueOf(), // birthtime (Windows & Mac)
                    mtime: fileTime.valueOf() // modified time (Windows, Mac, Linux)
                }).then(() => {
                    resolve(true)
                }).catch(err => {
                    reject("failed to set file creation date:", err)
                })
            }
            else {
                reject("status error");
            }
        });
    });
});

main();


// Don't look at this
process.on('uncaughtException', function (err) {
    if (err.code == "ECONNRESET")
        progress.downloadSucceeded(false);
});
