import { classifyFace, classifyPose, headAngles, type Point } from '@oratoria/defense';
import { VISION_MODEL, managedStatus, readManaged } from '@oratoria/model-manager';
import { basePath } from '../services';

export type VisionFrame = {
  face: boolean;
  contact: boolean;
  down: boolean;
  smile: boolean;
  pose: boolean;
  handsVisible: boolean;
  handsMoving: boolean;
  touchFace: boolean;
  tilt: number | null;
  midX: number | null;
  shoulderW: number | null;
};
/** Los modelos de cámara están instalados y completos. */
export async function visionInstalled(): Promise<boolean> {
  try {
    return (await managedStatus(VISION_MODEL, basePath)).installed;
  } catch {
    return false;
  }
}
export type VisionAnalyzer = { analyze: (video: HTMLVideoElement) => VisionFrame | null; close: () => void };
export async function createVision(): Promise<VisionAnalyzer> {
  const face = new Uint8Array(await readManaged(VISION_MODEL, 'face.task', basePath)),
    pose = new Uint8Array(await readManaged(VISION_MODEL, 'pose.task', basePath));
  const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${basePath}mediapipe`);
  const make = (delegate: 'GPU' | 'CPU') =>
    Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: face.slice(), delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: pose.slice(), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    ]);
  let tasks: Awaited<ReturnType<typeof make>>;
  try {
    tasks = await make('GPU');
  } catch {
    tasks = await make('CPU');
  }
  const [faceTask, poseTask] = tasks;
  let last = 0,
    wrists: { l: Point | null; r: Point | null } | null = null;
  return {
    analyze(video) {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const ts = Math.max(last + 1, Math.round(performance.now()));
      last = ts;
      const f = faceTask.detectForVideo(video, ts),
        p = poseTask.detectForVideo(video, ts);
      const blend: Record<string, number> = {};
      for (const c of f.faceBlendshapes[0]?.categories ?? []) blend[c.categoryName] = c.score;
      const matrix = f.facialTransformationMatrixes[0]?.data;
      const faceSeen = (f.faceLandmarks[0]?.length ?? 0) > 0;
      const fs = faceSeen && matrix ? classifyFace(blend, headAngles(matrix)) : null;
      const ps = p.landmarks[0] ? classifyPose(p.landmarks[0], wrists) : null;
      wrists = ps?.wrists ?? null;
      return {
        face: faceSeen,
        contact: !!fs?.contact,
        down: !!fs?.down,
        smile: !!fs?.smile,
        pose: !!ps,
        handsVisible: !!ps?.handsVisible,
        handsMoving: !!ps?.handsMoving,
        touchFace: !!ps?.touchFace,
        tilt: ps?.tilt ?? null,
        midX: ps?.midX ?? null,
        shoulderW: ps?.shoulderW ?? null,
      };
    },
    close() {
      faceTask.close();
      poseTask.close();
    },
  };
}
