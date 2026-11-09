
import * as THREE from 'three';

import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';

import { hideGizmos } from '../scene/Lights.js';

// EXPORT CONFIGURATION

const EXPORT_CONFIG = {
  glb: {
    extension: 'glb',
    mimeType: 'model/gltf-binary',
    binary: true,
    exporter: GLTFExporter
  },

  gltf: {
    extension: 'gltf',
    mimeType: 'model/gltf+json',
    binary: false,
    exporter: GLTFExporter
  },

  obj: {
    extension: 'obj',
    mimeType: 'text/plain',
    binary: false,
    exporter: OBJExporter
  },

  stl: {
    extension: 'stl',
    mimeType: 'model/stl',
    binary: true,
    exporter: STLExporter
  },

  ply: {
    extension: 'ply',
    mimeType: 'application/octet-stream',
    binary: true,
    exporter: PLYExporter
  }
};

// FILE UTILITIES

function createBlob(data, mimeType) {
  return new Blob([data], {
    type: mimeType
  });
}

function createDownloadURL(blob) {
  return URL.createObjectURL(blob);
}

function downloadFile(data, filename, mimeType) {
  const blob = createBlob(data, mimeType);
  const url = createDownloadURL(blob);

  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

// SCENE TRANSFORMATION

function prepareScene(world, format) {
  const gizmos = hideGizmos(world);

  const requiresYUp = !['stl', 'ply'].includes(format);

  world.rotation.x = requiresYUp
    ? -Math.PI / 2
    : 0;

  world.updateMatrixWorld(true);

  return function restoreScene() {
    world.rotation.x = 0;

    world.updateMatrixWorld(true);

    if (typeof gizmos === 'function') {
      gizmos();
    }
  };
}

// EXPORT RESULT HANDLING

function serializeResult(result, format) {
  if (format === 'gltf') {
    return JSON.stringify(result);
  }

  return result;
}

function getFilename(format) {
  return `model.${format}`;
}

// EXPORT EXECUTION

function executeExporter(world, format, config, restore) {
  const exporter = new config.exporter();

  const handleSuccess = result => {
    try {
      const data = serializeResult(result, format);

      downloadFile(
        data,
        getFilename(format),
        config.mimeType
      );
    } finally {
      restore();
    }
  };

  const handleError = error => {
    console.error(`Failed to export ${format}:`, error);
    restore();
  };

  try {
    const options = {
      binary: config.binary
    };

    if (format === 'stl') {
      handleSuccess(exporter.parse(world, options));
    } else if (format === 'obj') {
      handleSuccess(exporter.parse(world));
    } else {
      exporter.parse(
        world,
        handleSuccess,
        handleError,
        options
      );
    }
  } catch (error) {
    handleError(error);
    return false;
  }

  return true;
}

// PUBLIC API 
export function save(data, name, type) {
  downloadFile(data, name, type);
}

export function exportScene(world, fmt) {
  if (!world || !Array.isArray(world.children) || world.children.length === 0) {
    console.warn('Cannot export an empty scene.');
    return false;
  }

  const format = String(fmt).toLowerCase();

  const config = EXPORT_CONFIG[format];

  if (!config) {
    console.error(`Unsupported export format: ${format}`);
    return false;
  }

  let restore;

  try {
    restore = prepareScene(world, format);
  } catch (error) {
    console.error('Failed to prepare scene:', error);
    return false;
  }

  return executeExporter(
    world,
    format,
    config,
    restore
  );
}
