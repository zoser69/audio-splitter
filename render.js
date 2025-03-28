const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// تعيين مسار ffmpeg و ffprobe
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

console.log('FFmpeg path:', ffmpegPath);
console.log('FFprobe path:', ffprobePath);

// إنشاء تطبيق Express
const app = express();
const port = process.env.PORT || 3000;

// إعداد محرك العرض EJS
app.set('view engine', 'ejs');

// تكوين الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// التأكد من وجود مجلدات الرفع والتنزيل
const uploadDir = path.join('/tmp', 'uploads');
const downloadDir = path.join('/tmp', 'downloads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

// تكوين تخزين الملفات المرفوعة
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        // إنشاء اسم فريد للملف المرفوع
        const uniqueFilename = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueFilename);
    }
});

// تكوين فلتر الملفات
const fileFilter = function(req, file, cb) {
    // قبول ملفات MP3 و WAV فقط
    if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/wav' || 
        file.originalname.endsWith('.mp3') || file.originalname.endsWith('.wav')) {
        cb(null, true);
    } else {
        cb(new Error('نوع الملف غير مدعوم. يرجى رفع ملفات MP3 أو WAV فقط.'), false);
    }
};

// إعداد Multer لرفع الملفات
const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // الحد الأقصى 50 ميجابايت
    }
});

// المسار الرئيسي
app.get('/', (req, res) => {
    res.render('index');
});

// مسار رفع الملفات
app.post('/upload', upload.single('audio'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحديد ملف صوتي' });
        }

        console.log('تم استلام ملف:', req.file);

        // الحصول على معلومات الملف المرفوع
        const uploadedFile = req.file;
        const originalName = path.parse(uploadedFile.originalname).name;
        const fileExtension = path.extname(uploadedFile.originalname);
        const filePath = uploadedFile.path;
        
        console.log('مسار الملف:', filePath);
        console.log('الاسم الأصلي:', originalName);
        console.log('امتداد الملف:', fileExtension);
        
        // التحقق من وجود الملف
        if (!fs.existsSync(filePath)) {
            console.error('الملف غير موجود:', filePath);
            return res.status(500).json({ error: 'الملف المرفوع غير موجود' });
        }
        
        // الحصول على طريقة التقسيم والمعلمات
        const splitMethod = req.body.splitMethod;
        console.log('طريقة التقسيم:', splitMethod);
        
        // إنشاء معرف فريد للجلسة
        const sessionId = uuidv4();
        const sessionDir = path.join(downloadDir, sessionId);
        
        console.log('مجلد الجلسة:', sessionDir);
        
        // إنشاء مجلد للجلسة
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        // تحديد طريقة التقسيم
        if (splitMethod === 'equalParts') {
            const partsCount = parseInt(req.body.partsCount);
            console.log('عدد الأجزاء:', partsCount);
            
            if (isNaN(partsCount) || partsCount < 2) {
                return res.status(400).json({ error: 'عدد الأجزاء يجب أن يكون على الأقل 2' });
            }
            
            // الحصول على مدة الملف الصوتي
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    console.error('خطأ في قراءة معلومات الملف:', err);
                    return res.status(500).json({ error: 'حدث خطأ أثناء معالجة الملف الصوتي' });
                }
                
                console.log('معلومات الملف:', metadata.format);
                
                if (!metadata.format || typeof metadata.format.duration === 'undefined') {
                    console.error('لم يتم العثور على معلومات المدة في الملف');
                    return res.status(500).json({ error: 'لم يتم التعرف على تنسيق الملف الصوتي' });
                }
                
                const duration = metadata.format.duration;
                console.log('مدة الملف:', duration);
                
                const segmentDuration = duration / partsCount;
                console.log('مدة كل جزء:', segmentDuration);
                
                // تقسيم الملف إلى أجزاء متساوية
                splitAudioBySegments(filePath, sessionDir, originalName, fileExtension, segmentDuration, partsCount)
                    .then(files => {
                        console.log('تم تقسيم الملف بنجاح:', files);
                        res.status(200).json({ files });
                    })
                    .catch(error => {
                        console.error('خطأ في تقسيم الملف:', error);
                        res.status(500).json({ error: 'حدث خطأ أثناء تقسيم الملف الصوتي' });
                    });
            });
        } else if (splitMethod === 'timeSegments') {
            const segmentDuration = parseInt(req.body.segmentDuration);
            console.log('مدة كل جزء:', segmentDuration);
            
            if (isNaN(segmentDuration) || segmentDuration < 1) {
                return res.status(400).json({ error: 'مدة الجزء يجب أن تكون على الأقل 1 ثانية' });
            }
            
            // الحصول على مدة الملف الصوتي
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    console.error('خطأ في قراءة معلومات الملف:', err);
                    return res.status(500).json({ error: 'حدث خطأ أثناء معالجة الملف الصوتي' });
                }
                
                console.log('معلومات الملف:', metadata.format);
                
                if (!metadata.format || typeof metadata.format.duration === 'undefined') {
                    console.error('لم يتم العثور على معلومات المدة في الملف');
                    return res.status(500).json({ error: 'لم يتم التعرف على تنسيق الملف الصوتي' });
                }
                
                const duration = metadata.format.duration;
                console.log('مدة الملف:', duration);
                
                const partsCount = Math.ceil(duration / segmentDuration);
                console.log('عدد الأجزاء المتوقعة:', partsCount);
                
                // تقسيم الملف حسب المدة الزمنية
                splitAudioBySegments(filePath, sessionDir, originalName, fileExtension, segmentDuration, partsCount)
                    .then(files => {
                        console.log('تم تقسيم الملف بنجاح:', files);
                        res.status(200).json({ files });
                    })
                    .catch(error => {
                        console.error('خطأ في تقسيم الملف:', error);
                        res.status(500).json({ error: 'حدث خطأ أثناء تقسيم الملف الصوتي' });
                    });
            });
        } else {
            return res.status(400).json({ error: 'طريقة تقسيم غير صالحة' });
        }
    } catch (error) {
        console.error('خطأ غير متوقع:', error);
        res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء معالجة الطلب' });
    }
});

// دالة لتقسيم الملف الصوتي إلى أجزاء
function splitAudioBySegments(filePath, outputDir, originalName, fileExtension, segmentDuration, partsCount) {
    return new Promise((resolve, reject) => {
        try {
            const outputFiles = [];
            let completedSegments = 0;
            let errorOccurred = false;
            
            // التحقق من وجود الملف
            if (!fs.existsSync(filePath)) {
                return reject(new Error(`الملف غير موجود: ${filePath}`));
            }
            
            // التحقق من وجود المجلد
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            console.log(`بدء تقسيم الملف ${filePath} إلى ${partsCount} أجزاء`);
            
            for (let i = 0; i < partsCount; i++) {
                if (errorOccurred) break;
                
                const startTime = i * segmentDuration;
                const outputFileName = `${originalName}_part${i + 1}${fileExtension}`;
                const outputPath = path.join(outputDir, outputFileName);
                const relativePath = `/downloads/${path.basename(outputDir)}/${outputFileName}`;
                
                console.log(`معالجة الجزء ${i + 1}/${partsCount}:`);
                console.log(`- وقت البدء: ${startTime}`);
                console.log(`- المدة: ${segmentDuration}`);
                console.log(`- مسار الإخراج: ${outputPath}`);
                
                const command = ffmpeg(filePath)
                    .setStartTime(startTime)
                    .setDuration(segmentDuration)
                    .output(outputPath)
                    .on('start', (commandLine) => {
                        console.log(`أمر FFmpeg للجزء ${i + 1}: ${commandLine}`);
                    })
                    .on('progress', (progress) => {
                        console.log(`تقدم الجزء ${i + 1}: ${JSON.stringify(progress)}`);
                    })
                    .on('end', () => {
                        console.log(`اكتمل الجزء ${i + 1}`);
                        
                        // التحقق من وجود الملف الناتج
                        if (fs.existsSync(outputPath)) {
                            const fileStats = fs.statSync(outputPath);
                            console.log(`حجم الملف الناتج: ${fileStats.size} بايت`);
                            
                            if (fileStats.size > 0) {
                                outputFiles.push({
                                    name: outputFileName,
                                    url: relativePath
                                });
                            } else {
                                console.error(`الملف الناتج فارغ: ${outputPath}`);
                                fs.unlinkSync(outputPath); // حذف الملف الفارغ
                            }
                        } else {
                            console.error(`لم يتم إنشاء الملف الناتج: ${outputPath}`);
                        }
                        
                        completedSegments++;
                        console.log(`الأجزاء المكتملة: ${completedSegments}/${partsCount}`);
                        
                        if (completedSegments === partsCount) {
                            if (outputFiles.length > 0) {
                                console.log(`تم تقسيم الملف بنجاح إلى ${outputFiles.length} أجزاء`);
                                resolve(outputFiles);
                            } else {
                                reject(new Error('فشل في إنشاء أي ملفات مقسمة صالحة'));
                            }
                        }
                    })
                    .on('error', (err) => {
                        console.error(`خطأ في تقسيم الجزء ${i + 1}:`, err);
                        errorOccurred = true;
                        reject(err);
                    });
                
                // تنفيذ الأمر
                try {
                    command.run();
                } catch (error) {
                    console.error(`خطأ في تشغيل أمر FFmpeg للجزء ${i + 1}:`, error);
                    errorOccurred = true;
                    reject(error);
                }
            }
            
            // التعامل مع حالة عدم وجود أجزاء
            if (partsCount === 0) {
                reject(new Error('لا توجد أجزاء للمعالجة'));
            }
        } catch (error) {
            console.error('خطأ غير متوقع في دالة تقسيم الملف:', error);
            reject(error);
        }
    });
}

// إضافة مسار للتنزيلات
app.use('/downloads', express.static(downloadDir));

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error('خطأ في الخادم:', err.stack);
    res.status(500).json({
        error: err.message || 'حدث خطأ أثناء معالجة الطلب'
    });
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
});
