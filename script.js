document.addEventListener('DOMContentLoaded', async () => {
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

    // DOM Elements
    const loadPdfBtn = document.getElementById('loadPdfBtn');
    const pdfFileInput = document.getElementById('pdfFileInput');
    const savePdfBtn = document.getElementById('savePdfBtn');
    const pdfViewer = document.getElementById('pdf-viewer');
    const pagesThumbnails = document.getElementById('pages-thumbnails');
    const toolButtons = document.querySelectorAll('.tool-btn');
    const textProperties = document.getElementById('text-properties');

    // State
    let pdfDoc = null;
    let pdfJsDoc = null;
    let currentTool = 'select';
    let edits = {};

    // Initialize pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

    // Event Listeners
    loadPdfBtn.addEventListener('click', () => pdfFileInput.click());
    pdfFileInput.addEventListener('change', handleFileSelect);
    savePdfBtn.addEventListener('click', savePdf);
    toolButtons.forEach(button => {
        button.addEventListener('click', () => selectTool(button.dataset.tool));
    });
    pdfViewer.addEventListener('click', handleViewerClick);


    // Functions
    async function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file || file.type !== 'application/pdf') {
            alert('Please select a valid PDF file.');
            return;
        }
        const arrayBuffer = await file.arrayBuffer();
        await loadPdf(arrayBuffer);
    }

    async function loadPdf(arrayBuffer) {
        pdfDoc = await PDFDocument.load(arrayBuffer);
        pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        edits = {};
        await renderAllPages();
    }

    function selectTool(tool) {
        currentTool = tool;
        toolButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        updatePropertiesPanel();
    }

    function updatePropertiesPanel() {
        textProperties.classList.toggle('hidden', currentTool !== 'text');
    }

    async function handleViewerClick(event) {
        if (currentTool === 'text') {
            const targetCanvas = event.target.closest('canvas');
            if (!targetCanvas) return;

            const pageNum = parseInt(targetCanvas.dataset.pageNumber);
            const rect = targetCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const text = prompt('Enter text:');
            if (!text) return;

            const fontSize = parseInt(document.getElementById('font-size-input').value);
            const color = document.getElementById('color-input').value;

            const newEdit = { type: 'text', x, y, text, fontSize, color, pageNum };
            if (!edits[pageNum]) edits[pageNum] = [];
            edits[pageNum].push(newEdit);

            await drawOnOverlay(newEdit);
        }
    }

    async function drawOnOverlay({ pageNum, type, ...data }) {
        let overlay = document.querySelector(`.overlay-canvas[data-page-number='${pageNum}']`);
        const pageCanvas = document.querySelector(`#pdf-viewer canvas[data-page-number='${pageNum}']`);

        if (!overlay) {
            overlay = document.createElement('canvas');
            overlay.className = 'overlay-canvas';
            overlay.width = pageCanvas.width;
            overlay.height = pageCanvas.height;
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.pointerEvents = 'none';
            overlay.dataset.pageNumber = pageNum;
            pageCanvas.parentElement.appendChild(overlay);
        }

        const ctx = overlay.getContext('2d');
        if (type === 'text') {
            const pdfPage = await pdfJsDoc.getPage(pageNum);
            const viewport = pdfPage.getViewport({ scale: 1 });
            const scale = pageCanvas.width / viewport.width;

            ctx.font = `${data.fontSize * scale}px Helvetica`;
            ctx.fillStyle = data.color;
            ctx.fillText(data.text, data.x, data.y);
        }
    }

    async function savePdf() {
        if (!pdfDoc) {
            alert('No PDF loaded to save.');
            return;
        }

        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (const pageNum in edits) {
            const page = pages[pageNum - 1];
            const { height } = page.getSize();
            const pageCanvas = document.querySelector(`#pdf-viewer canvas[data-page-number='${pageNum}']`);

            const pdfPageForScale = await pdfJsDoc.getPage(parseInt(pageNum));
            const viewport = pdfPageForScale.getViewport({scale: 1});
            const scale = pageCanvas.width / viewport.width; // This is the pixels/points scale

            for (const edit of edits[pageNum]) {
                if (edit.type === 'text') {
                    page.drawText(edit.text, {
                        x: edit.x / scale,
                        y: height - (edit.y / scale),
                        font,
                        size: edit.fontSize,
                        color: hexToRgb(edit.color),
                    });
                }
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'edited.pdf';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    async function deletePage(pageNum) {
        if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.getPageCount()) return;
        pdfDoc.removePage(pageNum - 1);

        const newEdits = {};
        delete edits[pageNum];
        for (const p in edits) {
            const pNum = parseInt(p);
            if (pNum > pageNum) {
                newEdits[pNum - 1] = edits[p];
            } else {
                newEdits[pNum] = edits[p];
            }
        }
        edits = newEdits;

        const pdfBytes = await pdfDoc.save();
        await loadPdf(pdfBytes);
    }

    async function rotatePage(pageNum) {
        if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.getPageCount()) return;
        if (edits[pageNum] && edits[pageNum].length > 0) {
            alert('Cannot rotate a page with existing edits. Please save your work and reload the document to rotate the page.');
            return;
        }
        const page = pdfDoc.getPage(pageNum - 1);
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + 90));
        const pdfBytes = await pdfDoc.save();
        await loadPdf(pdfBytes);
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return rgb(r, g, b);
    }

    async function renderAllPages() {
        pdfViewer.innerHTML = '';
        pagesThumbnails.innerHTML = '';
        for (let i = 1; i <= pdfJsDoc.numPages; i++) {
            const pageWrapper = await renderPage(i, pdfViewer, 1.5);
            pdfViewer.appendChild(pageWrapper);
            const thumbWrapper = await renderThumbnail(i, pagesThumbnails, 0.3);
            pagesThumbnails.appendChild(thumbWrapper);
        }
    }

    async function renderPage(pageNum, container, scale) {
        const page = await pdfJsDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.dataset.pageNumber = pageNum;
        const renderContext = { canvasContext: context, viewport: viewport };
        await page.render(renderContext).promise;
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.marginBottom = '20px';
        wrapper.appendChild(canvas);
        return wrapper;
    }

    async function renderThumbnail(pageNum, container, scale) {
        const page = await pdfJsDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const thumbnailWrapper = document.createElement('div');
        thumbnailWrapper.classList.add('page-thumbnail');
        thumbnailWrapper.dataset.pageNumber = pageNum;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const renderContext = { canvasContext: context, viewport: viewport };
        await page.render(renderContext).promise;
        const pageActions = document.createElement('div');
        pageActions.className = 'page-actions';
        const rotateBtn = document.createElement('button');
        rotateBtn.className = 'page-action-btn';
        rotateBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
        rotateBtn.title = 'Rotate Page';
        rotateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            rotatePage(pageNum);
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'page-action-btn';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Delete Page';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePage(pageNum);
        });
        pageActions.appendChild(rotateBtn);
        pageActions.appendChild(deleteBtn);
        thumbnailWrapper.appendChild(pageActions);
        thumbnailWrapper.appendChild(canvas);
        return thumbnailWrapper;
    }

    selectTool('select');
});
