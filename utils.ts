import { gmath, png, printImageString } from "./deps.ts";

export interface Dimensions {
  width: number;
  height: number;
}

interface Padding {
  unpadded: number;
  padded: number;
}

function getRowPadding(width: number): Padding {
  // It is a webgpu requirement that BufferCopyView.layout.bytes_per_row % COPY_BYTES_PER_ROW_ALIGNMENT(256) == 0
  // So we calculate padded_bytes_per_row by rounding unpadded_bytes_per_row
  // up to the next multiple of COPY_BYTES_PER_ROW_ALIGNMENT.
  // https://en.wikipedia.org/wiki/Data_structure_alignment#Computing_padding
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const align = 256;
  const paddedBytesPerRowPadding = (align - unpaddedBytesPerRow % align) %
    align;
  const paddedBytesPerRow = unpaddedBytesPerRow + paddedBytesPerRowPadding;

  return {
    unpadded: unpaddedBytesPerRow,
    padded: paddedBytesPerRow,
  };
}

interface CreateCapture {
  texture: GPUTexture;
  outputBuffer: GPUBuffer;
}

export function createCapture(
  device: GPUDevice,
  dimensions: Dimensions,
): CreateCapture {
  const { padded } = getRowPadding(dimensions.width);
  const outputBuffer = device.createBuffer({
    size: padded * dimensions.height,
    usage: 1 | 8,
  });
  const texture = device.createTexture({
    size: dimensions,
    format: "rgba8unorm-srgb",
    usage: 0x10 | 1,
  });

  return { outputBuffer, texture };
}

export function copyToBuffer(
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  outputBuffer: GPUBuffer,
  dimensions: Dimensions,
): void {
  const { padded } = getRowPadding(dimensions.width);

  encoder.copyTextureToBuffer(
    {
      texture,
    },
    {
      buffer: outputBuffer,
      bytesPerRow: padded,
      rowsPerImage: 0,
    },
    dimensions,
  );
}

/** If path is undefined, thee buffer will be rendered to the terminal */
export async function createImage(
  buffer: GPUBuffer,
  dimensions: Dimensions,
  terminal?: boolean,
): Promise<void> {
  await buffer.mapAsync(1);
  const inputBuffer = new Uint8Array(buffer.getMappedRange());
  const { padded, unpadded } = getRowPadding(dimensions.width);
  const outputBuffer = new Uint8Array(unpadded * dimensions.height);

  for (let i = 0; i < dimensions.height; i++) {
    const slice = inputBuffer
      .slice(i * padded, (i + 1) * padded)
      .slice(0, unpadded);

    outputBuffer.set(slice, i * unpadded);
  }

  if (terminal) {
    printImageString({
      rawPixels: {
        data: outputBuffer,
        ...dimensions,
      },
      color: true,
    });
  } else {
    const image = png.encode(
      outputBuffer,
      dimensions.width,
      dimensions.height,
      {
        stripAlpha: true,
        color: 2,
      },
    );
    await Deno.writeFile("./output.png", image);
  }

  buffer.unmap();
}

interface BufferInit {
  label?: string;
  usage: number;
  contents: ArrayBuffer;
}

export function createBufferInit(
  device: GPUDevice,
  descriptor: BufferInit,
): GPUBuffer {
  const contents = new Uint8Array(descriptor.contents);

  const unpaddedSize = contents.byteLength;
  const padding = 4 - unpaddedSize % 4;
  const paddedSize = padding + unpaddedSize;

  const buffer = device.createBuffer({
    label: descriptor.label,
    usage: descriptor.usage,
    mappedAtCreation: true,
    size: paddedSize,
  });
  const data = new Uint8Array(buffer.getMappedRange());
  data.set(contents);
  buffer.unmap();
  return buffer;
}

// deno-fmt-ignore
export const OPENGL_TO_WGPU_MATRIX = gmath.Matrix4.fromCols(
  1.0, 0.0, 0.0, 0.0,
  0.0, 1.0, 0.0, 0.0,
  0.0, 0.0, 0.5, 0.0,
  0.0, 0.0, 0.5, 1.0,
);
