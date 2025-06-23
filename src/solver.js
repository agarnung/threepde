import * as THREE from 'three';

export class Solver {
    // Tipos de PDEs a resolver
    static PDE_TYPES = {
        HEAT: 'heat',       // Ecuación de difusión, o de conducción, o de calor, o de Fourier
        WAVE: 'wave',       // Ecuación de onda
        EXPONENTIAL_DECAY: 'exponential-decay', // Ley del decaimiento exponencial du​/dt = −λu
        // GENERAL_WAVE: '¿?',  // Generaliza la de onda
        // LAPLACE: 'laplace'  // Ecuación de Laplace
    };

    // Tipos de condiciones de frontera soportadas
    static BOUNDARY_TYPES = {
        DIRICHLET: 'dirichlet',       // Valores fijos (puede ser cualquier valor)
        ZERO: 'zero',                 // Caso especial de Dirichlet con u=0
        NEUMANN: 'neumann',           // Derivada fija (flujo constante)
        FIXED: 'fixed',               // Valores originales (de u_0)
        REFLECTIVE: 'reflective',     // Caso especial de Neumann con ∂u/∂n=0
        PERIODIC: 'periodic',         // Bordes conectados (izq-der, arr-aba)
        ROBIN: 'robin',               // Condición mixta (αu + β∂u/∂n = γ)
        // MIXED: 'mixed',            // Diferentes tipos en diferentes bordes
        // CAUCHY: 'cauchy'           // Condición general de primer orden
    };

    // Tipos de esquemas numéricos para resolver las PDEs
    static SCHEME_TYPES = {
        FORWARD_EULER: 'forward-euler',  // Explícito
        BACKWARD_EULER: 'backward-euler' // Implícito 
    };

    constructor({
        // Valores por defecto
        imageData,
        deltaPx = 1.0,
        dt = 0.1,
        pdeType = 'heat',
        boundaryType = 'periodic',
        schemeType = 'forward-euler',
        useGPU = 'false'
    }) {
        this.width = imageData.width;
        this.height = imageData.height;
        this.deltaPx = deltaPx;
        this.dt = dt;
        this.useGPU = useGPU;

        // Parámetros específicos de PDEs
        this.c = 50.0;
        this.alpha = 10.0;
        this.lambda = 10.0;

        const validPdeTypes = Object.values(Solver.PDE_TYPES);
        const validBoundaryTypes = Object.values(Solver.BOUNDARY_TYPES);
        const validSchemeTypes = Object.values(Solver.SCHEME_TYPES);

        this.pdeType = validPdeTypes.includes(pdeType.toLowerCase()) ? pdeType.toLowerCase() : Solver.PDE_TYPES.HEAT;
        this.boundaryType = validBoundaryTypes.includes(boundaryType.toLowerCase()) ? boundaryType.toLowerCase() : Solver.BOUNDARY_TYPES.PERIODIC;
        this.schemeType = validSchemeTypes.includes(schemeType.toLowerCase()) ? schemeType.toLowerCase() : Solver.SCHEME_TYPES.FORWARD_EULER;

        this.calculateCoefficient();

        // Verificar condición de estabilidad solo para esquemas explícitos
        if (this.schemeType === Solver.SCHEME_TYPES.FORWARD_EULER) {
            if (this.pdeType === Solver.PDE_TYPES.HEAT && this.coeff > 0.5) {
                console.warn(`¡Condición de estabilidad no satisfecha para ecuación de calor! (${this.coeff} > 0.5). La simulación puede ser inestable. Considera usar otro esquema.`);
            }

            if (this.pdeType === Solver.PDE_TYPES.WAVE && this.coeff > 1.0) {
                console.warn(`¡Condición de CFL no satisfecha para ecuación de onda! (${Math.sqrt(this.coeff)} > 1). La simulación puede ser inestable. Considera usar otro esquema.`);
            }

            if (this.pdeType === Solver.PDE_TYPES.EXPONENTIAL_DECAY && this.dt > 2 / this.lambda) {
                console.warn(`¡Condición de estabilidad no satisfecha para decaimiento exponencial! (${this.dt} > 2/λ). La simulación puede ser inestable.`);
            }
        }

        // Normalizar imagen
        this.imageData = this.cloneImageData(imageData);

        // Inicializar el solver ya sea en CPU o GPU
        this.reset();

        // Guardar estado original para condiciones FIXED
        if (this.boundaryType === Solver.BOUNDARY_TYPES.FIXED) {
            this.originalState = this.deepCopyMatrix(this.currentState);
        }
    }

    normalizeImageData(imageData) {
        const matrix = [];
        for (let y = 0; y < this.height; y++) {
            const row = [];
            for (let x = 0; x < this.width; x++) {
                const idx = (y * this.width + x) * 4;
                row.push(imageData.data[idx] / 255.0); // Normalizar a [0,1] y almacenar
            }
            matrix.push(row);
        }
        return matrix;
    }

    step() {
        if (this.pdeType === Solver.PDE_TYPES.HEAT) {
            return this.stepHeatEquation();
        } else if (this.pdeType === Solver.PDE_TYPES.WAVE) {
            return this.stepWaveEquation();
        } else {
            return this.stepExpDecayEquation();
        }
    }

    stepHeatEquation() {
        // Ecuación de calor: ∂u/∂t = c∇²u
        if (this.schemeType === Solver.SCHEME_TYPES.FORWARD_EULER) {
            return this.stepHeatEquationFE();
        } else {
            return this.stepHeatEquationBE();
        }
    }

    stepHeatEquationFE() {
        // Forward Euler explícito para ecuación de calor
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const laplacian = (
                    this.currentState[y][x - 1] +
                    this.currentState[y][x + 1] +
                    this.currentState[y - 1][x] +
                    this.currentState[y + 1][x] -
                    4 * this.currentState[y][x]
                );

                this.nextState[y][x] = this.currentState[y][x] + this.coeff * laplacian;
                this.nextState[y][x] = this.clamp_zero_one(this.nextState[y][x]);
            }
        }

        this.applyBoundaryConditions();

        [this.currentState, this.nextState] = [this.nextState, this.currentState];

        return this.denormalizeToImageData(this.currentState);
    }

    stepHeatEquationBE() {
        // Backward Euler implícito para ecuación de calor
        // Necesitamos resolver un sistema lineal: (I - coeff * L) u^{n+1} = u^n
        // Donde L es el operador laplaciano discreto

        // Para simplificar, usamos Jacobi iteration para resolver el sistema
        const maxIter = 50;
        const tolerance = 1e-4;

        // Inicializar solución con el estado actual
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.nextState[y][x] = this.currentState[y][x];
            }
        }

        for (let iter = 0; iter < maxIter; iter++) {
            let maxDiff = 0;

            const tempState = this.deepCopyMatrix(this.nextState); // Jacobi necesita una copia del estado anterior

            for (let y = 1; y < this.height - 1; y++) {
                for (let x = 1; x < this.width - 1; x++) {
                    const rhs = this.currentState[y][x];

                    const neighborSum =
                        tempState[y][x - 1] +
                        tempState[y][x + 1] +
                        tempState[y - 1][x] +
                        tempState[y + 1][x];

                    const newValue = (rhs + this.coeff * neighborSum) / (1 + 4 * this.coeff);
                    const diff = Math.abs(newValue - this.nextState[y][x]);
                    if (diff > maxDiff) maxDiff = diff;

                    this.nextState[y][x] = this.clamp_zero_one(newValue);
                }
            }

            this.applyBoundaryConditions();

            if (maxDiff < tolerance) break;
        }

        [this.currentState, this.nextState] = [this.nextState, this.currentState];

        return this.denormalizeToImageData(this.currentState);
    }

    stepWaveEquation() {
        // Ecuación de onda: ∂²u/∂t² = c²∇²u
        if (this.schemeType === Solver.SCHEME_TYPES.FORWARD_EULER) {
            return this.stepWaveEquationFE();
        } else {
            return this.stepWaveEquationBE();
        }
    }

    stepWaveEquationFE() {
        // Forward Euler explícito para ecuación de onda
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const laplacian = (
                    this.currentState[y][x - 1] +
                    this.currentState[y][x + 1] +
                    this.currentState[y - 1][x] +
                    this.currentState[y + 1][x] -
                    4 * this.currentState[y][x]
                );

                this.nextState[y][x] =
                    2 * this.currentState[y][x] -
                    this.previousState[y][x] +
                    this.coeff * laplacian;

                this.nextState[y][x] = this.clamp_zero_one(this.nextState[y][x]);
            }
        }

        this.applyBoundaryConditions();

        [this.previousState, this.currentState, this.nextState] = [this.currentState, this.nextState, this.previousState];

        return this.denormalizeToImageData(this.currentState);
    }

    stepWaveEquationBE() {
        // Backward Euler implícito para ecuación de onda
        // Necesitamos resolver un sistema lineal: (I - coeff * L) u^{n+1} = 2u^n - u^{n-1} + coeff * L u^n
        // Es más complejo que para la ecuación de calor

        // Para simplificar, usamos un enfoque semi-implícito aquí
        const maxIter = 25; // Más de 25 se vio que afecta gravemente a los FPS
        const tolerance = 1e-4;

        // Inicializar con currentState
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.nextState[y][x] = this.currentState[y][x];
            }
        }

        for (let iter = 0; iter < maxIter; iter++) {
            let maxDiff = 0;
            const temp = this.deepCopyMatrix(this.nextState);

            for (let y = 1; y < this.height - 1; y++) {
                for (let x = 1; x < this.width - 1; x++) {
                    // RHS = 2*u^n - u^{n-1}
                    const rhs = 2 * this.currentState[y][x] - this.previousState[y][x];

                    // Jacobi iteration
                    const neighborSum =
                        temp[y][x - 1] +
                        temp[y][x + 1] +
                        temp[y - 1][x] +
                        temp[y + 1][x];

                    const newValue = (rhs + this.coeff * neighborSum) / (1 + 4 * this.coeff);
                    const diff = Math.abs(newValue - this.nextState[y][x]);
                    if (diff > maxDiff) maxDiff = diff;

                    this.nextState[y][x] = this.clamp_zero_one(newValue);
                }
            }

            this.applyBoundaryConditions();

            if (maxDiff < tolerance) break;
        }

        // Actualizar los estados
        [this.previousState, this.currentState, this.nextState] = [this.currentState, this.nextState, this.previousState];

        return this.denormalizeToImageData(this.currentState);
    }

    stepExpDecayEquation() {
        // Ecuación de decaimiento exponencial: ∂u/∂t = -λu = f(u, t)
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const current = this.currentState[y][x];

                if (this.schemeType === Solver.SCHEME_TYPES.FORWARD_EULER) {
                    this.nextState[y][x] = this.clamp_zero_one(current * this.coeff);
                } else {
                    this.nextState[y][x] = this.clamp_zero_one(current * this.coeff);
                }
            }
        }

        [this.currentState, this.nextState] = [this.nextState, this.currentState];

        return this.denormalizeToImageData(this.currentState);
    }

    applyBoundaryConditions() {
        const { width, height } = this;

        switch (this.boundaryType.toLowerCase()) {
            // BORDES PERIÓDICOS
            case Solver.BOUNDARY_TYPES.PERIODIC:
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = this.nextState[y][width - 2];
                    this.nextState[y][width - 1] = this.nextState[y][1];
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = this.nextState[height - 2][x];
                    this.nextState[height - 1][x] = this.nextState[1][x];
                }
                break;

            // BORDES DIRICHLET: valores fijos originales (en concreto, aquí decimos que sea el borde de la condición inicial)
            case Solver.BOUNDARY_TYPES.DIRICHLET:
                const fixedValue = 0.5;
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = fixedValue;
                    this.nextState[y][width - 1] = fixedValue;
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = fixedValue;
                    this.nextState[height - 1][x] = fixedValue;
                }
                break;

            // BORDES EN CERO (caso especial de Dirichlet con valor 0)
            case Solver.BOUNDARY_TYPES.ZERO:
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = 0.0;
                    this.nextState[y][width - 1] = 0.0;
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = 0.0;
                    this.nextState[height - 1][x] = 0.0;
                }
                break;

            // BORDES FIXED: valor fijo constante (es Dirichlet, pero con valores fijos para todo el borde)
            case Solver.BOUNDARY_TYPES.FIXED:
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = this.originalState[y][0];
                    this.nextState[y][width - 1] = this.originalState[y][width - 1];
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = this.originalState[0][x];
                    this.nextState[height - 1][x] = this.originalState[height - 1][x];
                }
                break;

            case Solver.BOUNDARY_TYPES.NEUMANN:
                // Derivada normal constante: ∂u/∂n = du_dn
                const du_dn = 1.0;

                for (let y = 0; y < height; y++) {
                    // Borde izquierdo (x = 0): u[0] = u[1] - dx * du_dn
                    this.nextState[y][0] = this.nextState[y][1] - this.deltaPx * du_dn;

                    // Borde derecho (x = width - 1): u[N-1] = u[N-2] + dx * du_dn
                    this.nextState[y][width - 1] = this.nextState[y][width - 2] + this.deltaPx * du_dn;
                }

                for (let x = 0; x < width; x++) {
                    // Borde superior (y = 0): u[0] = u[1] - dy * du_dn
                    this.nextState[0][x] = this.nextState[1][x] - this.deltaPx * du_dn;

                    // Borde inferior (y = height - 1): u[N-1] = u[N-2] + dy * du_dn
                    this.nextState[height - 1][x] = this.nextState[height - 2][x] + this.deltaPx * du_dn;
                }
                break;

            case Solver.BOUNDARY_TYPES.REFLECTIVE:
                // Caso especial de Neumann con ∂u/∂n=0 (conservación de energía)
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = this.nextState[y][1];
                    this.nextState[y][width - 1] = this.nextState[y][width - 2];
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = this.nextState[1][x];
                    this.nextState[height - 1][x] = this.nextState[height - 2][x];
                }
                break;

            case Solver.BOUNDARY_TYPES.ROBIN:
                // Condición mixta: αu + β∂u/∂n = γ
                const alpha = 1.0;
                const beta = 1.0;
                const gamma = 0.0;

                for (let y = 0; y < height; y++) {
                    // Borde izquierdo (x = 0)
                    this.nextState[y][0] = (beta * this.nextState[y][1] + gamma) / (beta + alpha);

                    // Borde derecho (x = width - 1)
                    this.nextState[y][width - 1] = (beta * this.nextState[y][width - 2] + gamma) / (beta + alpha);
                }

                for (let x = 0; x < width; x++) {
                    // Borde superior (y = 0)
                    this.nextState[0][x] = (beta * this.nextState[1][x] + gamma) / (beta + alpha);

                    // Borde inferior (y = height - 1)
                    this.nextState[height - 1][x] = (beta * this.nextState[height - 2][x] + gamma) / (beta + alpha);
                }
                break;

            // case Solver.BOUNDARY_TYPES.MIXED:
            //     //...
            //     break;

            // case Solver.BOUNDARY_TYPES.CAUCHY:
            //     //...
            //     break;

            default:
                console.warn(`Tipo de condición de frontera no reconocido: ${this.boundaryType}. Usando periódica por defecto.`);
                // Bordes periódicos por defecto
                for (let y = 0; y < height; y++) {
                    this.nextState[y][0] = this.nextState[y][width - 2];
                    this.nextState[y][width - 1] = this.nextState[y][1];
                }
                for (let x = 0; x < width; x++) {
                    this.nextState[0][x] = this.nextState[height - 2][x];
                    this.nextState[height - 1][x] = this.nextState[1][x];
                }
                break;
        }
    }

    setBoundaryType(newBoundaryType) {
        if (Object.values(Solver.BOUNDARY_TYPES).includes(newBoundaryType)) {
            this.boundaryType = newBoundaryType;

            // Si es FIXED, se necesita guardar el estado actual como el original
            if (this.boundaryType === Solver.BOUNDARY_TYPES.FIXED) {
                this.originalState = this.deepCopyMatrix(this.currentState);
            }
        } else {
            console.warn(`Tipo de condición de frontera no válido: ${newBoundaryType}`);
        }
    }

    setPDEType(newPdeType) {
        if (Object.values(Solver.PDE_TYPES).includes(newPdeType)) {
            this.pdeType = newPdeType;
            this.calculateCoefficient(); // Recalcular coeficiente
        } else {
            console.warn(`Tipo de PDE no válido: ${newPdeType}`);
        }
    }

    setSchemeType(newSchemeType) {
        if (Object.values(Solver.SCHEME_TYPES).includes(newSchemeType)) {
            this.schemeType = newSchemeType;
        } else {
            console.warn(`Tipo de esquema no válido: ${newSchemeType}`);
        }
    }

    setUseGPU(useGPU) {
        this.useGPU = useGPU;
    }

    calculateCoefficient() {
        // Asumiendo deltaPx == deltaX = deltaY
        switch (this.pdeType) {
            case Solver.PDE_TYPES.HEAT:
            {
                this.coeff = (this.c * this.dt) / (this.deltaPx * this.deltaPx); // Para ecuación de calor
                break;                    
            }

            case Solver.PDE_TYPES.WAVE:
            {
                this.coeff = (this.c * this.dt / this.deltaPx) ** 2; // Para ecuación de onda
                break;
            }

            case Solver.PDE_TYPES.EXPONENTIAL_DECAY:
            {
                if (this.schemeType === Solver.SCHEME_TYPES.FORWARD_EULER) {
                    // Forward Euler: u^{n+1} = u^n + dt * f(u^n, t^n) <=> u^{n+1} = u^n - dt * λ * u^n
                    this.coeff = 1 - this.lambda * this.dt;      
                } else {
                    // Backward Euler: u^{n+1} = u^n + dt * f(u^{n+1}, t^{n+1}) <=>  u^{n+1} = u^n / (1 + dt * λ)
                    this.coeff = 1 / (1 + this.lambda * this.dt); 
                }
                break;
            }

            default:
                throw new Error('Tipo de PDE no soportado');
        }
    }

    denormalizeToImageData(matrix) {
        const newImageData = new ImageData(this.width, this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = (y * this.width + x) * 4;
                const value = Math.round(matrix[y][x] * 255);
                // Asignar el mismo valor a R, G, B (escala de grises)
                newImageData.data[idx] = value;     // R
                newImageData.data[idx + 1] = value; // G
                newImageData.data[idx + 2] = value; // B
                newImageData.data[idx + 3] = 255;   // Alpha (totalmente opaco)
            }
        }
        return newImageData;
    }

    createZeroMatrix() {
        return Array.from({ length: this.height }, () => Array(this.width).fill(0));
    }

    cloneImageData(imageData) {
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    deepCopyMatrix(matrix) {
        return matrix.map(row => row.slice());
    }

    // Clamping estricto tras cada iteración
    clamp_zero_one(value) {
        return Math.max(0, Math.min(1, value));
    }

    // Volver a condiciones iniciales
    reset() {
        this.currentState = this.deepCopyMatrix(this.normalizeImageData(this.imageData));  // u_k = u_0
        this.previousState = this.deepCopyMatrix(this.currentState); // u_prev = u_k
        this.nextState = this.createZeroMatrix();
    }
}