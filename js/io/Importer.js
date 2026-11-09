import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// GLOBAL IMPORT SYSTEM

const ImportSystem = {
  version: '1.0.0',
  coordinateSystem: 'Z_UP',
  defaultMaterialColor: 0xaaaaaa,

  options: {
    shadows: true,
    computeNormals: true,
    computeBoundingSphere: true,
    cloneGeometry: true,
    applyWorldTransforms: true
  }
};

// FILE PICKER SERVICE

class FilePickerService {
  static async open(accept = '*/*') {
    return new Promise((resolve, reject) => {
      const element = document.createElement('input');

      element.type = 'file';
      element.accept = accept;
      element.multiple = true;

      element.onchange = () => {
        resolve(Array.from(element.files || []));
      };

      element.onerror = reject;

      element.click();
    });
  }
}

export function pickFiles(accept) {
  return FilePickerService.open(accept);
}

// MATERIAL MANAGEMENT

class MaterialFactory {
  static createDefault() {
    return new THREE.MeshStandardMaterial({
      color: ImportSystem.defaultMaterialColor,
      roughness: 0.5,
      metalness: 0
    });
  }

  static normalize(material) {
    if (material?.isMeshStandardMaterial) {
      return material;
    }

    return this.createDefault();
  }

  static createVertexMaterial(geometry) {
    const material = this.createDefault();

    if (geometry.attributes.color) {
      material.vertexColors = true;
      material.color.set(0xffffff);
    }

    return material;
  }
}

// GEOMETRY PROCESSING PIPELINE

class GeometryProcessor {
  static coordinateCorrection() {
    return new THREE.Matrix4().makeRotationX(Math.PI / 2);
  }

  static clone(geometry) {
    return ImportSystem.options.cloneGeometry
      ? geometry.clone()
      : geometry;
  }

  static transform(geometry, matrix) {
    if (ImportSystem.options.applyWorldTransforms) {
      geometry.applyMatrix4(matrix);
    }

    return geometry;
  }

  static correctCoordinates(geometry) {
    geometry.applyMatrix4(this.coordinateCorrection());
    return geometry;
  }

  static calculateNormals(geometry) {
    if (
      ImportSystem.options.computeNormals &&
      !geometry.attributes.normal
    ) {
      geometry.computeVertexNormals();
    }

    return geometry;
  }

  static calculateBounds(geometry) {
    if (ImportSystem.options.computeBoundingSphere) {
      geometry.computeBoundingSphere();
    }

    return geometry;
  }

  static process(geometry, matrix = new THREE.Matrix4()) {
    return this.calculateBounds(
      this.calculateNormals(
        this.correctCoordinates(
          this.transform(
            this.clone(geometry),
            matrix
          )
        )
      )
    );
  }
}

// MESH FACTORY

class MeshFactory {
  static create(geometry, material, name = 'Mesh') {
    const mesh = new THREE.Mesh(
      geometry,
      material || MaterialFactory.createDefault()
    );

    mesh.name = name;

    if (ImportSystem.options.shadows) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    return mesh;
  }
}

// SCENE EXTRACTION

class SceneExtractor {
  static extract(root, callback) {
    root.updateMatrixWorld(true);

    root.traverse(object => {
      if (!object.isMesh) return;

      const geometry = GeometryProcessor.process(
        object.geometry,
        object.matrixWorld
      );

      callback(
        geometry,
        object.material,
        object.name || 'Mesh'
      );
    });
  }
}

function bake(root, add) {
  SceneExtractor.extract(root, add);
}

// FILE READING SERVICE

class FileReaderService {
  static async read(file) {
    return file.arrayBuffer();
  }

  static async readText(buffer) {
    return new TextDecoder().decode(buffer);
  }

  static getExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  static getBaseName(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }
}

// FORMAT LOADER REGISTRY

const LoaderRegistry = {

  glb: {
    async load(buffer) {
      const loader = new GLTFLoader();
      const result = await loader.parseAsync(buffer, '');
      return result.scene;
    }
  },

  gltf: {
    async load(buffer) {
      const loader = new GLTFLoader();
      const text = await FileReaderService.readText(buffer);
      const result = await loader.parseAsync(text, '');
      return result.scene;
    }
  },

  fbx: {
    async load(buffer) {
      return new FBXLoader().parse(buffer, '');
    }
  },

  obj: {
    async load(buffer) {
      const text = await FileReaderService.readText(buffer);
      return new OBJLoader().parse(text);
    }
  },

  stl: {
    async load(buffer, context) {
      return {
        geometry: new STLLoader().parse(buffer),
        name: context.base
      };
    }
  },

  ply: {
    async load(buffer, context) {
      return {
        geometry: new PLYLoader().parse(buffer),
        name: context.base
      };
    }
  }
};

// IMPORT PIPELINE

class ImportPipeline {

  constructor(file) {
    this.file = file;

    this.context = {
      extension: FileReaderService.getExtension(file.name),
      base: FileReaderService.getBaseName(file.name),
      buffer: null,
      result: [],
      startTime: performance.now()
    };
  }

  async validate() {
    if (!LoaderRegistry[this.context.extension]) {
      throw new Error(
        `Unsupported format: .${this.context.extension}`
      );
    }
  }

  async read() {
    this.context.buffer = await FileReaderService.read(
      this.file
    );
  }

  async load() {
    const loader = LoaderRegistry[this.context.extension];

    this.context.loaded = await loader.load(
      this.context.buffer,
      this.context
    );
  }

  async extract() {
    const { extension, loaded, base } = this.context;

    const add = (geometry, material, name) => {
      const processed = GeometryProcessor.process(geometry);

      this.context.result.push(
        MeshFactory.create(
          processed,
          MaterialFactory.normalize(material),
          name
        )
      );
    };

    if (extension === 'stl' || extension === 'ply') {
      const geometry = loaded.geometry;

      add(
        geometry,
        MaterialFactory.createVertexMaterial(geometry),
        loaded.name || base
      );

      return;
    }

    if (extension === 'obj') {
      bake(loaded, (geometry, material, name) => {
        add(geometry, MaterialFactory.createDefault(), name);
      });
      
      return;
    }

    if (extension === 'fbx') {
      bake(loaded, (geometry, material, name) => {
        add(
          geometry,
          MaterialFactory.normalize(material),
          name
        );
      });

      return;
    }

    bake(loaded, add);
  }

  async execute() {
    try {
      await this.validate();
      await this.read();
      await this.load();
      await this.extract();

      this.context.duration =
        performance.now() - this.context.startTime;

      return this.context.result;

    } catch (error) {
      console.error(
        `[ImportSystem] Failed to import ${this.file.name}`,
        error
      );

      throw error;
    }
  }
}

// PUBLIC IMPORT API

export async function importFile(file) {
  if (!(file instanceof File)) {
    throw new TypeError('Expected a File object.');
  }

  const pipeline = new ImportPipeline(file);

  return pipeline.execute();
}