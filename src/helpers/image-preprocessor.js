import { rgbToLab } from './color-maps.js';

// Convierte una imagen a escala de grises y la redimensiona a 512x512 píxeles, asumiendo que la imagen de entrada 
// está idealmente en formato WebP (i.e. RGBA, aunque funciona con cualquier formato soportado por canvas).
// Devuelve un objeto ImageData con los píxeles procesados, así como los valores a y b de Lab originales.
export function preprocessImageToGrayscale(imgElement, Nx, Ny) {
    // Create canvas with original dimensions
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.width;
    canvas.height = imgElement.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    
    // Get original image data
    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = originalImageData.data;
    const totalPixels = canvas.width * canvas.height;

    // Prepare arrays for Lab components
    const LData = new Float32Array(totalPixels);
    const aData = new Float32Array(totalPixels);
    const bData = new Float32Array(totalPixels);

    // Convert RGB to Lab for each pixel
    for (let i = 0; i < totalPixels; i++) {
        const r = data[i * 4] / 255;
        const g = data[i * 4 + 1] / 255;
        const b = data[i * 4 + 2] / 255;
        
        // Convert RGB to Lab
        const [L, a, b_] = rgbToLab(r, g, b);
        
        LData[i] = L;
        aData[i] = a;
        bData[i] = b_;
    }

    // Create grayscale image (using just L channel) with target dimensions (Nx, Ny)
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = Nx;
    targetCanvas.height = Ny;
    const targetCtx = targetCanvas.getContext('2d');
    
    // Draw original image resized to target dimensions
    targetCtx.drawImage(imgElement, 0, 0, Nx, Ny);
    const targetImageData = targetCtx.getImageData(0, 0, Nx, Ny);
    const targetData = targetImageData.data;
    
    // Convert to grayscale (L channel)
    for (let i = 0; i < Nx * Ny; i++) {
        const r = targetData[i * 4];
        const g = targetData[i * 4 + 1];
        const b = targetData[i * 4 + 2];
        // const luminance = L / 100.0; // Con Lab
        // const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b; // Con Rec. 709 (sRGB)
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b; // Con Rec. 601 (BT.709)
        targetData[i * 4] = luminance;
        targetData[i * 4 + 1] = luminance;
        targetData[i * 4 + 2] = luminance;
        targetData[i * 4 + 3] = 255;
    }

    return {
        imageData: targetImageData,  // Grayscale image with target dimensions
        LData,                      // Original L channel
        aData,                      // Original a channel
        bData                       // Original b channel
    };
}