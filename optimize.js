const fs = require('fs');
const path = require('path');

const imagesRoot = path.join(__dirname, 'images');
const outputRoot = path.join(__dirname, 'images-optimized');

// 압축 품질
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;

// 최적화 대상 확장자
const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

let totalOriginalSize = 0;
let totalOptimizedSize = 0;

let processedCount = 0;
let copiedCount = 0;
let failedCount = 0;

const failedFiles = [];

let inputDir = '';
let outputDir = '';

/**
 * byte 단위의 파일 크기를
 * KB / MB / GB 형태로 변환
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';

  const abs = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    Math.floor(Math.log(abs) / Math.log(1024)),
    units.length - 1
  );

  return `${(abs / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function printUsage() {
  console.error('');
  console.error('사용법:');
  console.error('  npm start -- <폴더> <가로:세로>');
  console.error('');
  console.error('예시:');
  console.error('  npm start -- notice_01 300:300');
  console.error('  npm start -- banners 1920:600');
  console.error('');
  console.error('요소의 가로·세로를 모두 채울 수 있는 크기로,');
  console.error('비율을 유지한 채 한 번에 줄입니다.');
  console.error('폴더는 images 아래 경로입니다.');
  console.error('결과는 images-optimized 아래 같은 폴더에 저장됩니다.');
  console.error('');
}

/**
 * 300:300 → { width: 300, height: 300 }
 */
function parseSize(sizeArg) {
  if (!sizeArg) {
    return null;
  }

  const parts = sizeArg.split(':').map(part => part.trim());

  if (parts.length !== 2) {
    return null;
  }

  const width = Number(parts[0]);
  const height = Number(parts[1]);

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    width,
    height,
  };
}

function parseArgs() {
  const folderArg = process.argv[2];
  const sizeArg = process.argv[3];

  if (!folderArg || !sizeArg) {
    printUsage();
    process.exit(1);
  }

  const size = parseSize(sizeArg);

  if (!size) {
    console.error('');
    console.error(`이미지 크기를 확인할 수 없습니다: ${sizeArg}`);
    console.error('요소의 가로와 세로를 모두 넣어야 합니다. 예: 300:300');
    printUsage();
    process.exit(1);
  }

  return {
    folderArg,
    ...size,
  };
}

function resolveInputDir(folderArg) {
  const underImages = path.join(imagesRoot, folderArg);

  if (fs.existsSync(underImages)) {
    return underImages;
  }

  const fromProject = path.isAbsolute(folderArg)
    ? folderArg
    : path.join(__dirname, folderArg);

  if (fs.existsSync(fromProject)) {
    return fromProject;
  }

  return underImages;
}

/**
 * images 폴더와 모든 하위 폴더를 순회하여
 * 파일 목록을 가져온다.
 */
function getFiles(dir) {
  const entries = fs.readdirSync(dir, {
    withFileTypes: true,
  });

  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files = files.concat(getFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 이미지 한 개를 최적화한다.
 *
 * 대상 요소의 가로·세로를 모두 채울 수 있는 크기로,
 * 원본 이미지의 비율을 유지한 채 줄인다.
 */
async function optimizeImage(inputPath, outputPath, targetWidth, targetHeight) {
  const ext = path.extname(inputPath).toLowerCase();
  const originalSize = fs.statSync(inputPath).size;
  const relativePath = path.relative(inputDir, inputPath);

  totalOriginalSize += originalSize;

  // 원본과 동일한 하위 폴더 구조 생성
  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  /**
   * JPG / JPEG / PNG / WebP가 아닌 파일은
   * 변환하지 않고 그대로 복사
   */
  if (!supportedExtensions.includes(ext)) {
    fs.copyFileSync(inputPath, outputPath);

    totalOptimizedSize += originalSize;
    copiedCount++;

    console.log(`[COPY] ${relativePath}`);
    console.log(`       최적화 대상 아님 → 원본 유지 (${formatSize(originalSize)})`);

    return;
  }

  try {
    const sharp = require('sharp');
    let image = sharp(inputPath).rotate();

    /**
     * fit: 'outside'
     *
     * 요소 가로·세로를 모두 채울 수 있는 크기로 한 번에 축소한다.
     * 한쪽은 요소와 같고, 다른 쪽은 비율대로 더 길다. 자르지 않는다.
     *
     * 예) 요소 300 × 300
     * 2500 × 1500 → 500 × 300
     * 1856 × 2304 → 300 × 372
     *
     * 예) 요소 1920 × 600
     * 4000 × 2000 → 1920 × 960
     */
    image = image.resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'outside',
      withoutEnlargement: true,
    });

    /**
     * 기존 확장자를 유지하면서 압축
     */
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        image = image.jpeg({
          quality: JPEG_QUALITY,
          mozjpeg: true,
        });
        break;

      case '.png':
        image = image.png({
          compressionLevel: 9,
        });
        break;

      case '.webp':
        image = image.webp({
          quality: WEBP_QUALITY,
        });
        break;
    }

    /**
     * 바로 결과 파일로 저장하지 않고
     * 임시 파일을 먼저 생성한다.
     */
    const tempPath = `${outputPath}.tmp`;

    await image.toFile(tempPath);

    const optimizedSize = fs.statSync(tempPath).size;

    /**
     * 다시 저장한 결과가 원본보다 크거나 같으면
     * 용량을 늘리지 않기 위해 원본을 유지한다.
     */
    if (optimizedSize >= originalSize) {
      fs.unlinkSync(tempPath);
      fs.copyFileSync(inputPath, outputPath);

      totalOptimizedSize += originalSize;
      copiedCount++;

      console.log(`[KEEP] ${relativePath}`);
      console.log(
        `       용량이 줄지 않음 → 원본 유지 (${formatSize(originalSize)})`
      );
    } else {
      fs.renameSync(tempPath, outputPath);

      totalOptimizedSize += optimizedSize;
      processedCount++;

      const reduction =
        ((originalSize - optimizedSize) / originalSize) * 100;

      console.log(`[OK] ${relativePath}`);
      console.log(
        `     ${formatSize(originalSize)} → ${formatSize(
          optimizedSize
        )} (-${reduction.toFixed(1)}%)`
      );
    }
  } catch (error) {
    failedCount++;
    failedFiles.push(inputPath);

    /**
     * 최적화에 실패하더라도
     * 결과 폴더에서 파일이 누락되지 않도록
     * 원본을 그대로 복사한다.
     */
    fs.copyFileSync(inputPath, outputPath);

    totalOptimizedSize += originalSize;

    console.error(`[ERROR] ${relativePath}`);
    console.error(`        ${error.message}`);
  }
}

async function main() {
  const { folderArg, width, height } = parseArgs();

  inputDir = resolveInputDir(folderArg);
  outputDir = path.join(
    outputRoot,
    path.relative(imagesRoot, inputDir) || path.basename(inputDir)
  );

  /**
   * images 폴더 존재 여부 확인
   */
  if (!fs.existsSync(inputDir)) {
    console.error('');
    console.error(`폴더를 찾을 수 없습니다: ${inputDir}`);
    console.error('');
    console.error(
      `optimize.js와 같은 위치의 images 아래에 "${folderArg}" 폴더를 만들어주세요.`
    );
    printUsage();

    return;
  }

  try {
    require('sharp');
  } catch (error) {
    console.error('');
    console.error('이미지 처리 모듈(sharp)을 불러오지 못했습니다.');
    console.error(error.message);
    console.error('');
    console.error('원본을 복사하지 않고 중단합니다.');
    console.error('');
    return;
  }

  /**
   * 해당 폴더의 이전 실행 결과가 있다면 삭제하고
   * 새로운 결과 폴더 생성
   */
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, {
      recursive: true,
      force: true,
    });
  }

  fs.mkdirSync(outputDir, {
    recursive: true,
  });

  const files = getFiles(inputDir);

  console.log('');
  console.log('========================================');
  console.log(' 이미지 최적화를 시작합니다.');
  console.log('========================================');
  console.log('');
  console.log(`대상 폴더 : ${inputDir}`);
  console.log(`대상 요소 : ${width} × ${height}`);
  console.log('작업 내용 : 요소를 채울 크기로 축소, 비율 유지, 크롭 없음');
  console.log(`JPG 품질 : ${JPEG_QUALITY}`);
  console.log(`WebP 품질 : ${WEBP_QUALITY}`);
  console.log('');
  console.log(`전체 파일 : ${files.length}개`);
  console.log('');
  console.log('========================================');
  console.log('');

  /**
   * 모든 파일 순차 처리
   */
  for (const inputPath of files) {
    const relativePath = path.relative(inputDir, inputPath);
    const outputPath = path.join(outputDir, relativePath);

    await optimizeImage(inputPath, outputPath, width, height);
  }

  /**
   * 전체 절감 결과 계산
   */
  const savedSize =
    totalOriginalSize - totalOptimizedSize;

  const reductionRate =
    totalOriginalSize > 0
      ? (savedSize / totalOriginalSize) * 100
      : 0;

  console.log('');
  console.log('========================================');
  console.log(' 이미지 최적화 완료');
  console.log('========================================');
  console.log('');

  console.log(`최적화 완료    : ${processedCount}개`);
  console.log(`원본 유지/복사 : ${copiedCount}개`);
  console.log(`실패           : ${failedCount}개`);

  console.log('');
  console.log(`원본 총 용량   : ${formatSize(totalOriginalSize)}`);
  console.log(`최적화 후      : ${formatSize(totalOptimizedSize)}`);
  console.log(
    savedSize >= 0
      ? `절감 용량      : ${formatSize(savedSize)}`
      : `증가 용량      : ${formatSize(savedSize)}`
  );
  console.log(`절감률         : ${reductionRate.toFixed(1)}%`);

  /**
   * 실패한 파일이 있다면 목록 출력
   */
  if (failedFiles.length > 0) {
    console.log('');
    console.log('실패한 파일:');

    failedFiles.forEach(file => {
      console.log(
        `- ${path.relative(inputDir, file)}`
      );
    });
  }

  console.log('');
  console.log('결과 폴더:');
  console.log(outputDir);
  console.log('');
  console.log('========================================');
}

main();
