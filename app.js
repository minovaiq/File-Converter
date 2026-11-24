const arabic = document.documentElement.lang === 'ar';
const translate = (english, arabicText) => arabic ? arabicText : english;

const filesInput = document.querySelector('#files');
const drop = document.querySelector('#drop');
const queue = document.querySelector('#queue');
const format = document.querySelector('#format');
const quality = document.querySelector('#quality');
const maxSide = document.querySelector('#maxSide');
const convert = document.querySelector('#convert');
const message = document.querySelector('#message');
const tiles = [...document.querySelectorAll('[data-format]')];
const entries = [];
let busy = false;

function announce(text) {
  message.textContent = text;
  message.hidden = !text;
}

function render() {
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
    row.append(name);
    if (entry.url) {
      const download = document.createElement('a');
      download.href = entry.url;
      download.download = entry.file.name.replace(/\.[^.]+$/, '') + '.' + entry.extension;
      download.textContent = translate('Download ', 'تنزيل ') + entry.extension.toUpperCase();
      const details = document.createElement('span');
      const kilobytes = entry.size / 1024;
      const size = kilobytes >= 1024
        ? (kilobytes / 1024).toFixed(1) + ' MB'
        : Math.max(1, Math.round(kilobytes)) + ' KB';
      details.textContent = entry.width + ' × ' + entry.height + ' · ' + size;
      details.dir = 'ltr';
      row.append(details, download);
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
      entries.splice(entries.indexOf(entry), 1);
      announce('');
      render();
    };
    row.append(remove);
    queue.append(row);
  }
}

function addFiles(files) {
  if (busy) return;
  const rejected = [];
  for (const file of files) {
    if (!/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name) || !file.size || file.size > 25 * 1024 ** 2) {
      rejected.push(file.name);
      continue;
    }
    entries.push({file});
  }
  announce(rejected.length ? translate('Unsupported, empty, or over 25 MB: ', 'ملفات غير مدعومة أو فارغة أو تتجاوز 25 ميغابايت: ') + rejected.join(', ') : '');
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
  for (const entry of entries) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = null;
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

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      // Some browsers can render formats their bitmap decoder rejects.
      if (!(error instanceof DOMException)) throw error;
    }
  }

  const image = new Image();
  const url = URL.createObjectURL(file);
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

async function convertFile(file, extension, level, limit) {
  const bitmap = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    const sourceWidth = bitmap.naturalWidth ?? bitmap.width;
    const sourceHeight = bitmap.naturalHeight ?? bitmap.height;
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const scale = limit > 0 ? Math.min(1, limit / largestSide) : 1;
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
    if (['jpg', 'bmp', 'pdf'].includes(extension)) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    if (extension === 'bmp') return {blob: makeBmp(canvas, context), width, height};
    const mime = ['jpg', 'pdf'].includes(extension) ? 'image/jpeg' : 'image/' + extension;
    const image = await encode(canvas, mime, level);
    const blob = extension === 'pdf' ? makePdf(image, width, height) : image;
    return {blob, width, height};
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
  for (const entry of entries) {
    try {
      const {blob, width, height} = await convertFile(entry.file, extension, level, limit);
      entry.url = URL.createObjectURL(blob);
      entry.size = blob.size;
      entry.width = width;
      entry.height = height;
      entry.extension = extension;
      completed++;
    } catch (error) {
      entry.error = error instanceof DOMException ? translate('Could not read this image.', 'تعذّرت قراءة الصورة.') : error.message;
    }
  }
  busy = false;
  render();
  announce(translate('Converted ' + completed + ' of ' + entries.length + ' image(s).', 'اكتمل تحويل ' + completed + ' من أصل ' + entries.length + ' صورة.'));
};
render();
