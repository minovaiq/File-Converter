const arabic = document.documentElement.lang === 'ar';
const translate = (english, arabicText) => arabic ? arabicText : english;

const filesInput = document.querySelector('#files');
const drop = document.querySelector('#previewArea') || document.querySelector('#drop');
const previews = document.querySelector('#previews');
const downloadResult = document.querySelector('#downloadResult');
const queue = document.querySelector('#queue');
const format = document.querySelector('#format');
const quality = document.querySelector('#quality');
const maxSide = document.querySelector('#maxSide');
const convert = document.querySelector('#convert');
const message = document.querySelector('#message');
const tiles = [...document.querySelectorAll('[data-format]')];
const entries = [];
let busy = false;
let archiveUrl;
let archiveGeneration = 0;

function announce(text) {
  message.textContent = text;
  message.hidden = !text;
}

function resultFilename(entry) {
  const base = entry.file.name.replace(/\.[^.]+$/, '').replace(/[\\/:\x00-\x1f]/g, '_').slice(0, 160);
  return (base || 'image') + '.' + entry.extension;
}

function renderPreviews() {
  if (!previews) return;
  previews.replaceChildren();
  previews.hidden = entries.length === 0;
  drop.classList.toggle('has-images', entries.length > 0);
  for (const entry of entries) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = entry.file.name;
    caption.dir = 'auto';
    const placeholder = document.createElement('span');
    placeholder.className = 'preview-placeholder';
    placeholder.textContent = entry.previewPending
      ? translate('Loading preview…', 'جارٍ تحميل المعاينة…')
      : translate('Preview unavailable', 'المعاينة غير متاحة');
    const url = entry.outputPreview || entry.inputPreview;
    if (url) {
      const image = document.createElement('img');
      image.alt = entry.file.name;
      image.onerror = () => image.replaceWith(placeholder);
      image.src = url;
      figure.append(image, caption);
    } else {
      figure.append(placeholder, caption);
    }
    previews.append(figure);
  }
}

function clearArchive() {
  archiveGeneration++;
  if (archiveUrl) URL.revokeObjectURL(archiveUrl);
  archiveUrl = null;
}

function render() {
  renderPreviews();
  const results = entries.filter(entry => entry.url);
  const single = results.length === 1 ? results[0] : null;
  const primaryUrl = downloadResult && !busy && (single?.url || archiveUrl);
  convert.hidden = Boolean(primaryUrl);
  if (downloadResult) {
    downloadResult.hidden = !primaryUrl;
    if (primaryUrl) {
      downloadResult.href = primaryUrl;
      downloadResult.download = single ? resultFilename(single) : 'converted-images.zip';
      downloadResult.textContent = single
        ? translate('Download ', 'تنزيل ') + single.extension.toUpperCase()
        : translate('Download all (ZIP)', 'تنزيل الكل (ZIP)');
    } else {
      downloadResult.removeAttribute('href');
    }
  }
  queue.replaceChildren();
  queue.hidden = entries.length === 0;
  convert.disabled = busy || !entries.length;
  filesInput.disabled = format.disabled = quality.disabled = busy;
  if (maxSide) maxSide.disabled = busy;
  for (const tile of tiles) {
    tile.disabled = busy;
    tile.setAttribute('aria-pressed', tile.dataset.format === format.value);
  }
  document.querySelector('#qualityField').hidden = !['jpg', 'webp', 'pdf'].includes(format.value);
  for (const entry of entries) {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = entry.file.name;
    const actions = document.createElement('div');
    actions.className = 'result-actions';
    row.append(name);
    if (entry.url) {
      const download = document.createElement('a');
      download.href = entry.url;
      download.download = resultFilename(entry);
      download.textContent = translate('Download ', 'تنزيل ') + entry.extension.toUpperCase();
      const details = document.createElement('span');
      const kilobytes = entry.size / 1024;
      const size = kilobytes >= 1024
        ? (kilobytes / 1024).toFixed(1) + ' MB'
        : Math.max(1, Math.round(kilobytes)) + ' KB';
      details.textContent = entry.width + ' × ' + entry.height + ' · ' + size;
      details.dir = 'ltr';
      row.append(details);
      if (!primaryUrl || !single) actions.append(download);
    } else if (entry.error) {
      const error = document.createElement('span');
      error.textContent = entry.error;
      row.append(error);
    }
    const remove = document.createElement('button');
    remove.textContent = translate('Remove', 'إزالة');
    remove.disabled = busy;
    remove.setAttribute('aria-label', translate('Remove ', 'إزالة ') + entry.file.name);
    remove.onclick = () => {
      if (entry.url) URL.revokeObjectURL(entry.url);
      if (entry.inputPreview) URL.revokeObjectURL(entry.inputPreview);
      clearArchive();
      entries.splice(entries.indexOf(entry), 1);
      const remaining = entries.filter(item => item.url);
      if (remaining.length > 1) prepareArchive(remaining);
      announce('');
      render();
    };
    actions.append(remove);
    row.append(actions);
    queue.append(row);
  }
}

function addFiles(files) {
  if (busy) return;
  const rejected = [];
  let batchFull = false;
  let added = false;
  let totalSize = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  for (const file of files) {
    if (!/\.(jpe?g|jfif|a?png|webp|gif|bmp|dib|avif)$/i.test(file.name) || !file.size || file.size > 25 * 1024 ** 2) {
      rejected.push(file.name);
      continue;
    }
    if (entries.length >= 12 || totalSize + file.size > 100 * 1024 ** 2) {
      batchFull = true;
      continue;
    }
    if (!added) resetResults();
    added = true;
    const entry = {file, previewPending: true};
    entries.push(entry);
    inspectImage(file).then(image => {
      if (entries.includes(entry)) entry.inputPreview = URL.createObjectURL(image);
    }).catch(() => {
      // Conversion reports the specific validation or decoding error.
    }).finally(() => {
      entry.previewPending = false;
      if (entries.includes(entry)) renderPreviews();
    });
    totalSize += file.size;
  }
  const notices = [];
  if (rejected.length) notices.push(translate('Unsupported, empty, or over 25 MB: ', 'ملفات غير مدعومة أو فارغة أو تتجاوز 25 ميغابايت: ') + rejected.slice(0, 5).join(', ') + (rejected.length > 5 ? '…' : ''));
  if (batchFull) notices.push(translate('Batch limit: 12 files or 100 MB total.', 'حد الدفعة: 12 ملفاً أو 100 ميغابايت إجمالاً.'));
  announce(notices.join(' '));
  render();
}

filesInput.onchange = () => {
  addFiles(filesInput.files);
  filesInput.value = '';
};
// Keep a missed file drop from navigating away and discarding the queue.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
}
drop.ondragover = event => {
  event.preventDefault();
  if (!busy) drop.classList.add('active');
};
drop.ondragleave = () => drop.classList.remove('active');
drop.ondrop = event => {
  event.preventDefault();
  drop.classList.remove('active');
  addFiles(event.dataTransfer.files);
};
function resetResults() {
  clearArchive();
  for (const entry of entries) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = null;
    entry.blob = null;
    entry.outputPreview = null;
    entry.error = null;
  }
  announce('');
  render();
}

format.onchange = resetResults;
quality.onchange = resetResults;
maxSide?.addEventListener('change', resetResults);
for (const tile of tiles) {
  tile.onclick = () => {
    if (format.value !== tile.dataset.format) {
      format.value = tile.dataset.format;
      resetResults();
    }
    format.focus();
  };
}

function encode(canvas, mime, level) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob?.size) reject(new Error(translate('The browser could not encode this image.', 'تعذّر حفظ الصورة في المتصفح.')));
      else if (blob.type !== mime) reject(new Error(translate('This browser cannot export the selected format.', 'متصفحك لا يدعم الحفظ بالصيغة المطلوبة.')));
      else resolve(blob);
    }, mime, level);
  });
}

function makeBmp(canvas, context) {
  const {width, height} = canvas;
  const stride = Math.ceil(width * 3 / 4) * 4;
  const bytes = new Uint8Array(54 + stride * height);
  const header = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  for (const [offset, value] of [[2, bytes.length], [10, 54], [14, 40], [18, width], [22, height], [34, stride * height]]) {
    header.setUint32(offset, value, true);
  }
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let y = 0; y < height; y++) {
    let output = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const input = (y * width + x) * 4;
      bytes[output++] = pixels[input + 2];
      bytes[output++] = pixels[input + 1];
      bytes[output++] = pixels[input];
    }
  }
  return new Blob([bytes], {type: 'image/bmp'});
}

function makePdf(jpeg, width, height) {
  const pageScale = Math.min(1, 842 / Math.max(width, height));
  const w = (width * pageScale).toFixed(4);
  const h = (height * pageScale).toFixed(4);
  const draw = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Im0 Do\nQ\n';
  const parts = [];
  const offsets = [];
  let size = 0;
  function append(part) {
    parts.push(part);
    size += typeof part === 'string' ? part.length : part.size;
  }
  function object(...body) {
    offsets.push(size);
    append(offsets.length + ' 0 obj\n');
    for (const part of body) append(part);
    append('\nendobj\n');
  }
  append('%PDF-1.4\n');
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  object('<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n', jpeg, '\nendstream');
  object('<< /Length ' + draw.length + ' >>\nstream\n' + draw + 'endstream');
  const xref = size;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, {type: 'application/pdf'});
}

async function makeIco(canvas) {
  const png = await encode(canvas, 'image/png');
  const header = new DataView(new ArrayBuffer(22));
  header.setUint16(2, 1, true);
  header.setUint16(4, 1, true);
  header.setUint8(6, canvas.width % 256);
  header.setUint8(7, canvas.height % 256);
  header.setUint16(10, 1, true);
  header.setUint16(12, 32, true);
  header.setUint32(14, png.size, true);
  header.setUint32(18, 22, true);
  return new Blob([header.buffer, png], {type: 'image/x-icon'});
}

function rgbPixels(pixels) {
  const rgb = new Uint8Array(pixels.length / 4 * 3);
  for (let input = 0, output = 0; input < pixels.length; input += 4, output += 3) {
    rgb[output] = pixels[input];
    rgb[output + 1] = pixels[input + 1];
    rgb[output + 2] = pixels[input + 2];
  }
  return rgb;
}

const pixelEncoders = {
  ppm(pixels, width, height) {
    return new Blob(['P6\n' + width + ' ' + height + '\n255\n', rgbPixels(pixels)], {type: 'image/x-portable-pixmap'});
  },
  tiff(pixels, width, height) {
    const rgb = rgbPixels(pixels);
    const tags = [
      [256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, 0],
      [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0],
      [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, rgb.length],
      [284, 3, 1, 1]
    ];
    const bitsOffset = 8 + 2 + tags.length * 12 + 4;
    tags[2][3] = bitsOffset;
    tags[5][3] = bitsOffset + 6;
    const header = new DataView(new ArrayBuffer(bitsOffset + 6));
    header.setUint16(0, 0x4949, true);
    header.setUint16(2, 42, true);
    header.setUint32(4, 8, true);
    header.setUint16(8, tags.length, true);
    for (const [index, [tag, type, count, value]] of tags.entries()) {
      const offset = 10 + index * 12;
      header.setUint16(offset, tag, true);
      header.setUint16(offset + 2, type, true);
      header.setUint32(offset + 4, count, true);
      header.setUint32(offset + 8, value, true);
    }
    for (let offset = bitsOffset; offset < bitsOffset + 6; offset += 2) header.setUint16(offset, 8, true);
    return new Blob([header.buffer, rgb], {type: 'image/tiff'});
  },
  tga(pixels, width, height) {
    const header = new DataView(new ArrayBuffer(18));
    header.setUint8(2, 2);
    header.setUint16(12, width, true);
    header.setUint16(14, height, true);
    header.setUint8(16, 32);
    header.setUint8(17, 0x28);
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      pixels[index] = pixels[index + 2];
      pixels[index + 2] = red;
    }
    return new Blob([header.buffer, pixels], {type: 'image/x-tga'});
  },
  qoi(pixels, width, height) {
    const header = new DataView(new ArrayBuffer(14));
    header.setUint32(0, 0x716f6966);
    header.setUint32(4, width);
    header.setUint32(8, height);
    header.setUint8(12, 4);
    const chunks = new Uint8Array(pixels.length / 4 * 5);
    let output = 0;
    let last = 255;
    let run = 0;
    const source = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    for (let index = 0; index < pixels.length; index += 4) {
      const pixel = source.getUint32(index);
      if (pixel === last) {
        run++;
        if (run === 62) {
          chunks[output++] = 0xc0 | (run - 1);
          run = 0;
        }
        continue;
      }
      if (run) chunks[output++] = 0xc0 | (run - 1);
      run = 0;
      chunks[output++] = 0xff;
      chunks.set(pixels.subarray(index, index + 4), output);
      output += 4;
      last = pixel;
    }
    if (run) chunks[output++] = 0xc0 | (run - 1);
    return new Blob([header.buffer, chunks.subarray(0, output), Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1)], {type: 'image/qoi'});
  }
};

async function inspectImage(file) {
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  const extension = file.name.split('.').pop().toLowerCase();
  let mime;
  if (/^(jpe?g|jfif)$/.test(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
  if (/^a?png$/.test(extension) && bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n') mime = 'image/png';
  if (extension === 'gif' && /^(GIF87a|GIF89a)$/.test(text(0, 6))) mime = 'image/gif';
  if (extension === 'webp' && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') mime = 'image/webp';
  if (/^(bmp|dib)$/.test(extension) && text(0, 2) === 'BM') mime = 'image/bmp';
  if (extension === 'avif' && text(4, 4) === 'ftyp') {
    const end = Math.min(new DataView(bytes.buffer).getUint32(0), bytes.length);
    for (let offset = 8; offset + 4 <= end; offset += 4) {
      if (offset !== 12 && /^(avif|avis)$/.test(text(offset, 4))) mime = 'image/avif';
    }
  }
  if (!mime) throw new Error(translate('The file contents do not match a supported image format.', 'محتوى الملف لا يطابق صيغة صورة مدعومة.'));
  return file.slice(0, file.size, mime);
}

async function decodeImage(file) {
  const imageFile = await inspectImage(file);
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(imageFile);
    } catch (error) {
      // Some browsers can render formats their bitmap decoder rejects.
      if (!(error instanceof DOMException)) throw error;
    }
  }

  const image = new Image();
  const url = URL.createObjectURL(imageFile);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(translate('Could not read this image. It may be damaged or unsupported by this browser.', 'تعذّرت قراءة الصورة. قد تكون تالفة أو بصيغة لا يدعمها متصفحك.')));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makePreview(canvas) {
  const thumbnail = document.createElement('canvas');
  const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  thumbnail.width = Math.max(1, Math.round(canvas.width * scale));
  thumbnail.height = Math.max(1, Math.round(canvas.height * scale));
  try {
    const context = thumbnail.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    return thumbnail.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    thumbnail.width = thumbnail.height = 0;
  }
}

const crcTable = Uint32Array.from({length: 256}, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc;
});

async function crc32(blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return (crc ^ 0xffffffff) >>> 0;
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
  } finally {
    reader.releaseLock();
  }
}

async function makeArchive(results) {
  const local = [];
  const central = [];
  const encoder = new TextEncoder();
  let offset = 0;
  let directorySize = 0;
  for (const [index, {filename, blob}] of results.entries()) {
    const name = encoder.encode((index + 1) + '-' + filename);
    const checksum = await crc32(blob);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x800, true);
    header.setUint16(12, 0x21, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, blob.size, true);
    header.setUint32(22, blob.size, true);
    header.setUint16(26, name.length, true);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    new Uint8Array(record.buffer).set(new Uint8Array(header.buffer, 4, 26), 6);
    record.setUint32(42, offset, true);
    local.push(header.buffer, name, blob);
    central.push(record.buffer, name);
    offset += header.byteLength + name.length + blob.size;
    directorySize += record.byteLength + name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, results.length, true);
  end.setUint16(10, results.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, end.buffer], {type: 'application/zip'});
}

async function prepareArchive(results) {
  const generation = archiveGeneration;
  try {
    const archive = await makeArchive(results.map(entry => ({
      filename: resultFilename(entry), blob: entry.blob
    })));
    if (generation !== archiveGeneration) return false;
    archiveUrl = URL.createObjectURL(archive);
    if (!busy) render();
    return true;
  } catch {
    return false;
  }
}

async function convertFile(file, extension, level, limit) {
  const bitmap = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    const sourceWidth = bitmap.naturalWidth ?? bitmap.width;
    const sourceHeight = bitmap.naturalHeight ?? bitmap.height;
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const target = extension === 'ico' ? Math.min(limit || 256, 256) : limit;
    const scale = target > 0 ? Math.min(1, target / largestSide) : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    if (!sourceWidth || !sourceHeight) throw new Error(translate('The image has no readable dimensions.', 'تعذّرت قراءة أبعاد الصورة.'));
    if (sourceWidth * sourceHeight > 32_000_000 || largestSide > 8192) {
      throw new Error(translate('Image dimensions are too large.', 'أبعاد الصورة تتجاوز الحد المدعوم.'));
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(translate('The browser could not allocate memory for this image.', 'ذاكرة المتصفح غير كافية لهذه الصورة.'));
    if (['jpg', 'bmp', 'pdf', 'tiff', 'ppm'].includes(extension)) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const preview = makePreview(canvas);
    if (extension === 'bmp') return {blob: makeBmp(canvas, context), width, height, preview};
    if (extension === 'ico') return {blob: await makeIco(canvas), width, height, preview};
    if (Object.hasOwn(pixelEncoders, extension)) {
      const pixels = context.getImageData(0, 0, width, height).data;
      return {blob: pixelEncoders[extension](pixels, width, height), width, height, preview};
    }
    const mime = ['jpg', 'pdf'].includes(extension) ? 'image/jpeg' : 'image/' + extension;
    const image = await encode(canvas, mime, level);
    const blob = extension === 'pdf' ? makePdf(image, width, height) : image;
    return {blob, width, height, preview};
  } finally {
    bitmap.close?.();
    canvas.width = canvas.height = 0;
  }
}

convert.onclick = async () => {
  if (busy || !entries.length) return;
  resetResults();
  busy = true;
  const extension = format.value;
  const level = Number(quality.value);
  const limit = Number(maxSide?.value ?? 0);
  render();
  announce(translate('Converting ' + entries.length + ' image(s)…', 'جارٍ تحويل الصور (' + entries.length + ')…'));
  let completed = 0;
  let outputSize = 0;
  for (const entry of entries) {
    try {
      const {blob, width, height, preview} = await convertFile(entry.file, extension, level, limit);
      if (outputSize + blob.size > 160 * 1024 ** 2) {
        throw new Error(translate('Batch output limit reached. Try fewer files or smaller dimensions.', 'بلغت حد حجم النتائج للدفعة. جرّب ملفات أقل أو أبعاداً أصغر.'));
      }
      outputSize += blob.size;
      entry.url = URL.createObjectURL(blob);
      entry.blob = blob;
      entry.outputPreview = preview;
      entry.size = blob.size;
      entry.width = width;
      entry.height = height;
      entry.extension = extension;
      completed++;
    } catch (error) {
      entry.error = error instanceof DOMException ? translate('Could not read this image.', 'تعذّرت قراءة الصورة.') : error.message;
    }
  }
  const archiveReady = completed < 2 || await prepareArchive(entries.filter(entry => entry.url));
  busy = false;
  render();
  const summary = translate('Converted ' + completed + ' of ' + entries.length + ' image(s).', 'اكتمل تحويل ' + completed + ' من أصل ' + entries.length + ' صورة.');
  announce(archiveReady ? summary : summary + ' ' + translate('Download each file separately.', 'نزّل كل ملف على حدة.'));
};
render();
