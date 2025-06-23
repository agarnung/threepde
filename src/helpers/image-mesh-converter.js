import * as THREE from 'three';

export function getHeightMapFromImageData(imageData, targetWidth, targetHeight) {
  const { data, width: imgWidth, height: imgHeight } = imageData;
  const heightMap = new Float32Array(targetWidth * targetHeight);
  
  // Muestreo con interpolación bilineal
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      // Coordenadas normalizadas
      const u = x / (targetWidth - 1);
      const v = y / (targetHeight - 1);
      
      // Coordenadas en la imagen
      const imgX = u * (imgWidth - 1);
      const imgY = v * (imgHeight - 1);
      
      // Interpolación bilineal
      const x1 = Math.floor(imgX);
      const y1 = Math.floor(imgY);
      const x2 = Math.min(x1 + 1, imgWidth - 1);
      const y2 = Math.min(y1 + 1, imgHeight - 1);
      
      // Valores de los 4 píxeles circundantes
      const q11 = data[(y1 * imgWidth + x1) * 4] / 255;
      const q12 = data[(y2 * imgWidth + x1) * 4] / 255;
      const q21 = data[(y1 * imgWidth + x2) * 4] / 255;
      const q22 = data[(y2 * imgWidth + x2) * 4] / 255;
      
      // Interpolación
      const heightValue = bilinearInterpolation(
        imgX - x1, imgY - y1,
        q11, q12, q21, q22
      );
      
      heightMap[y * targetWidth + x] = heightValue;
    }
  }

  return heightMap;
}

export function bilinearInterpolation(x, y, q11, q12, q21, q22) {
  return q11 * (1 - x) * (1 - y) +
         q21 * x * (1 - y) +
         q12 * (1 - x) * y +
         q22 * x * y;
}

export function createHeightMesh(heightMapFlat, subdivisionsX, subdivisionsY, normalize = false, scale = 1, usePercentiles = false, enhanceContrast = false) {
  // Usamos BufferGeometry para mejor control
  const geometry = new THREE.BufferGeometry();

  const width = subdivisionsX;
  const height = subdivisionsY;
  const sizeX = 10;
  const sizeY = 10 * (height / width);
  
  // Crear vértices
  const vertices = new Float32Array(width * height * 3);
  const uvs = new Float32Array(width * height * 2);
  
  // Cálculo de rango dinámico
  let min, max, range;
  
  if (usePercentiles) {
    // Ajuste de rango dinámico con percentiles (5% y 95%) para evitar outliers
    const sortedHeights = [...heightMapFlat].sort((a, b) => a - b);
    min = sortedHeights[Math.floor(sortedHeights.length * 0.05)];
    max = sortedHeights[Math.floor(sortedHeights.length * 0.95)];
  } else {
    // Usando mínimo y máximo absolutos
    // min = Math.min(...heightMapFlat);
    // max = Math.max(...heightMapFlat);
    max = heightMapFlat.reduce((a, b) => Math.max(a, b), -Infinity);
    min = heightMapFlat.reduce((a, b) => Math.min(a, b), Infinity);
  }
  range = max - min || 1; // Evitar división por cero

  let vertexIndex = 0;
  let uvIndex = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Posición XZ
      const px = (x / (width - 1) - 0.5) * sizeX;
      const pz = (y / (height - 1) - 0.5) * sizeY;
      
      // Altura normalizada (si acaso con ajuste no lineal para mejor contraste)
      let py;
      const heightValue = heightMapFlat[y * width + x];
      if (normalize) {
        let normalizedHeight = (heightValue - min) / range;
        if (enhanceContrast) {
          normalizedHeight = Math.pow(normalizedHeight, 1.5);
        }
        py = normalizedHeight * scale;
      }
      else {
        py = heightValue;
      }
      
      // Asignar vértices
      vertices[vertexIndex++] = px;
      vertices[vertexIndex++] = py;
      vertices[vertexIndex++] = pz;
      
      // Coordenadas UV
      uvs[uvIndex++] = x / (width - 1);
      uvs[uvIndex++] = 1 - (y / (height - 1));
    }
  }
  
  // Crear índices para las caras
  const indices = [];
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = y * width + x;
      const b = y * width + x + 1;
      const c = (y + 1) * width + x;
      const d = (y + 1) * width + x + 1;
      
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }
  
  // Asignar atributos a la geometría
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  
  // Poner en el plano horizontal
  geometry.rotateX(- Math.PI / 2);
  geometry.rotateZ(Math.PI / 2);
  geometry.rotateY(Math.PI);

  // Calcular normales
  geometry.computeVertexNormals();
  
  // Crear atributo de color (valor inicial 0.5)
  const colors = new Float32Array(width * height * 3);
  for (let i = 0; i < colors.length; i++) {
      colors[i] = 0.533; // 0x88 en [0-1]
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Material mejorado
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, // Habilitar el uso de colores de vértices
    roughness: 0.7,
    metalness: 0.3,
    side: THREE.DoubleSide,
    flatShading: false
  });
  // const material = new THREE.MeshBasicMaterial({
  //   vertexColors: true,
  //   side: THREE.DoubleSide
  // });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "mesh";
  mesh.rotation.x = -Math.PI / 2;
  
  // Creear wireframe
  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({
        color: 0x888888,          
        transparent: true,
        opacity: 0.5            
    })
  );
  wireframe.name = "wireframe";
  wireframe.rotation.x = -Math.PI / 2;

  // Agrupar ambos
  const meshGroup = new THREE.Group();
  meshGroup.add(mesh);
  meshGroup.add(wireframe);

  return meshGroup;
}