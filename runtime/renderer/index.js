import createRendererController from "./controller.js";
import { createCanvas2dRenderer } from "./backends/canvas2d.js";
import { createWebGLRenderer } from "./backends/webgl.js";
import { createSvgRenderer } from "./backends/svg.js";
import { SceneTileLoader } from "./lazy-loader.js";
import {
  SCENE_FORMAT_VERSION,
  SCENE_COMMAND_MOVE,
  SCENE_COMMAND_CURVE,
  SCENE_COMMAND_CLOSE,
  SCENE_COMMAND_STRIDE,
  createVectorScenePayload,
  deserializeVectorScene,
  contoursToBezierCommands,
  commandsToSvgPath,
} from "./adapters/scene-format.js";
import * as vectorData from "./adapters/vector-data.js";

const rendererExports = {
  createRendererController,
  createCanvas2dRenderer,
  createWebGLRenderer,
  createSvgRenderer,
  SceneTileLoader,
  sceneFormat: {
    SCENE_FORMAT_VERSION,
    SCENE_COMMAND_MOVE,
    SCENE_COMMAND_CURVE,
    SCENE_COMMAND_CLOSE,
    SCENE_COMMAND_STRIDE,
    createVectorScenePayload,
    deserializeVectorScene,
    contoursToBezierCommands,
    commandsToSvgPath,
  },
  vectorData,
};

const globalTarget = typeof globalThis === "object" ? globalThis : null;

if (globalTarget) {
  if (typeof globalTarget.capyRenderer !== "object" || globalTarget.capyRenderer === null) {
    globalTarget.capyRenderer = {};
  }
  Object.assign(globalTarget.capyRenderer, rendererExports);
  globalTarget.capyRenderer.__legacyLoaderVersion = "2024-07-28";
}

export {
  createRendererController,
  createCanvas2dRenderer,
  createWebGLRenderer,
  createSvgRenderer,
  SceneTileLoader,
  createVectorScenePayload,
  deserializeVectorScene,
  contoursToBezierCommands,
  commandsToSvgPath,
  SCENE_FORMAT_VERSION,
  SCENE_COMMAND_MOVE,
  SCENE_COMMAND_CURVE,
  SCENE_COMMAND_CLOSE,
  SCENE_COMMAND_STRIDE,
};

export default rendererExports;
