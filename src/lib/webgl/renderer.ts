import {
  type GradientProgram,
  type SolidProgram,
  createGradientProgram,
  createSolidProgram,
} from "./shaders";

export interface PanelRenderData {
  top: number;
  height: number;
  lineMesh: Float32Array;
  lineColor: Float32Array;
  areaMesh: Float32Array | null;
  areaColor: Float32Array | null;
  gridMesh: Float32Array;
  gridVertexCount: number;
  /** Separator line mesh (2 vertices for GL_LINES) */
  separatorMesh: Float32Array;
}

interface PanelBuffers {
  lineVAO: WebGLVertexArrayObject;
  lineBuffer: WebGLBuffer;
  lineVertexCount: number;
  areaVAO: WebGLVertexArrayObject | null;
  areaBuffer: WebGLBuffer | null;
  areaVertexCount: number;
  gridVAO: WebGLVertexArrayObject;
  gridBuffer: WebGLBuffer;
  gridVertexCount: number;
  separatorVAO: WebGLVertexArrayObject;
  separatorBuffer: WebGLBuffer;
}

export class WebGLChartRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private solidProgram: SolidProgram | null = null;
  private gradientProgram: GradientProgram | null = null;
  private canvas: HTMLCanvasElement;
  private panelBuffers = new Map<number, PanelBuffers>();
  private dpr = 1;
  private cssHeight = 0;
  private gridColor: Float32Array = new Float32Array([
    0.153, 0.153, 0.165, 1.0,
  ]);
  private separatorColor: Float32Array = new Float32Array([
    0.247, 0.247, 0.275, 1.0,
  ]);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  init(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return false;

    this.gl = gl;

    try {
      this.solidProgram = createSolidProgram(gl);
      this.gradientProgram = createGradientProgram(gl);
    } catch (e) {
      console.error("WebGL shader compilation failed:", e);
      return false;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return true;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
  }

  setThemeColors(grid: Float32Array, separator: Float32Array): void {
    this.gridColor = grid;
    this.separatorColor = separator;
  }

  updatePanelData(panelIndex: number, data: PanelRenderData): void {
    const gl = this.gl;
    if (!gl) return;

    // Reuse this panel's existing VAOs/buffers and just re-upload the vertex
    // data, rather than deleting and recreating GL objects on every update.
    // Allocating/freeing VAOs+buffers each frame (on every zoom/resize/theme
    // change) causes driver churn and GC pressure; bufferData with DYNAMIC_DRAW
    // reuses the storage.
    const existing = this.panelBuffers.get(panelIndex);

    const line = this.uploadBuffer(
      gl,
      existing ? { vao: existing.lineVAO, buffer: existing.lineBuffer } : null,
      data.lineMesh,
      this.solidProgram!.aPosition,
    );
    if (!line) return;
    const lineVertexCount = data.lineMesh.length / 2;

    let areaVAO = existing?.areaVAO ?? null;
    let areaBuffer = existing?.areaBuffer ?? null;
    let areaVertexCount = 0;
    if (data.areaMesh) {
      const area = this.uploadBuffer(
        gl,
        areaVAO && areaBuffer ? { vao: areaVAO, buffer: areaBuffer } : null,
        data.areaMesh,
        this.gradientProgram!.aPosition,
      );
      if (area) {
        areaVAO = area.vao;
        areaBuffer = area.buffer;
        areaVertexCount = data.areaMesh.length / 2;
      }
    }

    const grid = this.uploadBuffer(
      gl,
      existing ? { vao: existing.gridVAO, buffer: existing.gridBuffer } : null,
      data.gridMesh,
      this.solidProgram!.aPosition,
    );
    if (!grid) return;

    const separator = this.uploadBuffer(
      gl,
      existing
        ? { vao: existing.separatorVAO, buffer: existing.separatorBuffer }
        : null,
      data.separatorMesh,
      this.solidProgram!.aPosition,
    );
    if (!separator) return;

    this.panelBuffers.set(panelIndex, {
      lineVAO: line.vao,
      lineBuffer: line.buffer,
      lineVertexCount,
      areaVAO,
      areaBuffer,
      areaVertexCount,
      gridVAO: grid.vao,
      gridBuffer: grid.buffer,
      gridVertexCount: data.gridVertexCount,
      separatorVAO: separator.vao,
      separatorBuffer: separator.buffer,
    });
  }

  render(
    panels: PanelRenderData[],
    marginLeft: number,
    marginTop: number,
    drawingWidth: number,
  ): void {
    const gl = this.gl;
    if (!gl) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const buffers = this.panelBuffers.get(i);
      if (!buffers) continue;

      // WebGL viewport: bottom-left origin, device pixels
      const vx = Math.round(marginLeft * this.dpr);
      const vy = Math.round(
        (this.cssHeight - marginTop - panel.top - panel.height) * this.dpr,
      );
      const vw = Math.round(drawingWidth * this.dpr);
      const vh = Math.round(panel.height * this.dpr);

      gl.viewport(vx, vy, vw, vh);
      gl.scissor(vx, vy, vw, vh);

      // 1. Grid lines
      gl.useProgram(this.solidProgram!.program);
      gl.uniform2f(this.solidProgram!.uResolution, drawingWidth, panel.height);
      gl.uniform4fv(this.solidProgram!.uColor, this.gridColor);
      gl.bindVertexArray(buffers.gridVAO);
      gl.drawArrays(gl.LINES, 0, buffers.gridVertexCount);

      // 2. Separator line
      gl.uniform4fv(this.solidProgram!.uColor, this.separatorColor);
      gl.bindVertexArray(buffers.separatorVAO);
      gl.drawArrays(gl.LINES, 0, 2);

      // 3. Area fill (if present, behind line)
      if (buffers.areaVAO && panel.areaColor) {
        gl.useProgram(this.gradientProgram!.program);
        gl.uniform2f(
          this.gradientProgram!.uResolution,
          drawingWidth,
          panel.height,
        );
        gl.uniform1f(this.gradientProgram!.uPanelHeight, panel.height);
        gl.uniform4fv(this.gradientProgram!.uColor, panel.areaColor);
        gl.bindVertexArray(buffers.areaVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.areaVertexCount);
      }

      // 4. Data line (on top)
      gl.useProgram(this.solidProgram!.program);
      gl.uniform2f(this.solidProgram!.uResolution, drawingWidth, panel.height);
      gl.uniform4fv(this.solidProgram!.uColor, panel.lineColor);
      gl.bindVertexArray(buffers.lineVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.lineVertexCount);
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;

    for (const [index] of this.panelBuffers) {
      this.deletePanelBuffers(index);
    }
    this.panelBuffers.clear();

    if (this.solidProgram) {
      gl.deleteProgram(this.solidProgram.program);
      this.solidProgram = null;
    }
    if (this.gradientProgram) {
      gl.deleteProgram(this.gradientProgram.program);
      this.gradientProgram = null;
    }

    this.gl = null;
  }

  /**
   * Create-or-update a VAO/buffer pair: reuses the existing pair when given one
   * (re-uploading via DYNAMIC_DRAW), otherwise allocates a new pair and wires up
   * the vertex attribute. The attribute pointer only needs to be set once at
   * creation — re-uploading the buffer keeps the VAO's binding valid.
   */
  private uploadBuffer(
    gl: WebGL2RenderingContext,
    existing: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } | null,
    data: Float32Array,
    attribLocation: number,
  ): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } | null {
    const isNew = !existing;
    const vao = existing?.vao ?? gl.createVertexArray();
    const buffer = existing?.buffer ?? gl.createBuffer();
    if (!vao || !buffer) return null;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    if (isNew) {
      gl.enableVertexAttribArray(attribLocation);
      gl.vertexAttribPointer(attribLocation, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
    return { vao, buffer };
  }

  private deletePanelBuffers(index: number): void {
    const gl = this.gl;
    const buffers = this.panelBuffers.get(index);
    if (!gl || !buffers) return;

    gl.deleteVertexArray(buffers.lineVAO);
    gl.deleteBuffer(buffers.lineBuffer);
    if (buffers.areaVAO) gl.deleteVertexArray(buffers.areaVAO);
    if (buffers.areaBuffer) gl.deleteBuffer(buffers.areaBuffer);
    gl.deleteVertexArray(buffers.gridVAO);
    gl.deleteBuffer(buffers.gridBuffer);
    gl.deleteVertexArray(buffers.separatorVAO);
    gl.deleteBuffer(buffers.separatorBuffer);
    this.panelBuffers.delete(index);
  }
}
