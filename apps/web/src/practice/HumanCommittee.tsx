import { memo, useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Euler,
  HemisphereLight,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { AnswerType, Participant, Temperament } from '@oratoria/conversation';
import { HumanAvatar, loadHumanPackage, type HumanPackage } from '../vendor/humanforge/runtime';
import { basePath } from '../services';
import type { AvatarHandle, AvatarMode } from './Avatar';
import type { Mouth } from '../voice/visemes';
import { humanLook } from './human-look';

const REST: Mouth = { open: 0, wide: 0.5, round: 0 };
const rotation = new Quaternion();
const euler = new Euler();
const reduced = () =>
  document.documentElement.dataset.motion === 'reduce' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adaptador del mismo contrato que las ilustraciones; ninguna reacción influye en la nota. */
class HumanRig implements AvatarHandle {
  mode: AvatarMode = 'listening';
  private mouth = { ...REST };
  private shown = { ...REST };
  private lookAt = 0;
  private raised = false;
  private reaction: { until: number; good: boolean } | null = null;
  private originals: Map<string, Quaternion>;
  constructor(
    readonly avatar: HumanAvatar,
    private temperament: Temperament,
    private seed: number,
  ) {
    for (const b of avatar.bones) {
      if (b.name.endsWith('LeftArm')) b.rotateZ(-0.8);
      if (b.name.endsWith('RightArm')) b.rotateZ(0.8);
      if (b.name.endsWith('LeftForeArm') || b.name.endsWith('RightForeArm')) b.rotateX(-0.24);
    }
    this.originals = new Map(avatar.bones.map((b) => [b.name, b.quaternion.clone()]));
  }
  setMouth = (m: Mouth) => {
    this.mouth = { ...m };
  };
  setMode = (mode: AvatarMode, lookAt = 0) => {
    this.mode = mode;
    this.lookAt = lookAt;
  };
  react = (type: AnswerType) => {
    this.reaction = {
      until: performance.now() + 1800,
      good: type === 'correcta' || type === 'reconoce_limitacion',
    };
  };
  raiseHand = (on: boolean) => {
    this.raised = on;
  };
  frame(ms: number, still: boolean) {
    const t = ms / 1000 + this.seed * 1.17;
    const friendly = this.temperament === 'amable' || this.temperament === 'cordial';
    const strict = this.temperament === 'exigente' || this.temperament === 'desafiante';
    const skeptical = this.temperament === 'esceptico';
    const reacting = this.reaction && ms < this.reaction.until ? this.reaction : null;
    const target = this.mode === 'speaking' ? this.mouth : REST;
    for (const key of ['open', 'wide', 'round'] as const)
      this.shown[key] += (target[key] - this.shown[key]) * 0.55;
    const expr: Record<string, number> = {
      jawOpen: this.shown.open * 0.65,
      mouthPucker: this.shown.round * this.shown.open * 0.55,
      mouthStretch: this.shown.wide * this.shown.open * 0.2,
      mouthSmile: reacting?.good ? 0.24 : friendly ? 0.12 : 0,
      browDownLeft: strict ? 0.12 : 0,
      browDownRight: strict ? 0.12 : 0,
      browOuterUpLeft: skeptical ? 0.25 : 0,
      browInnerUpLeft: reacting && !reacting.good ? 0.15 : 0,
      eyeSquintLeft: skeptical ? 0.1 : 0,
      eyeSquintRight: skeptical ? 0.1 : 0,
    };
    const blinkCycle = t % (4.1 + this.seed * 0.23);
    expr.eyeBlinkLeft = expr.eyeBlinkRight =
      !still && blinkCycle < 0.18 ? Math.sin((blinkCycle / 0.18) * Math.PI) : 0;
    for (const [key, value] of Object.entries(expr)) this.avatar.setExpression(key, value);
    for (const b of this.avatar.bones) {
      const base = this.originals.get(b.name)!;
      let x = 0,
        y = 0,
        z = 0;
      if (b.name.endsWith('Head')) {
        y = this.lookAt * 0.15;
        z = skeptical ? 0.035 : 0;
        if (!still) {
          x = Math.sin(t * 1.1) * 0.012 + (reacting?.good ? Math.sin(t * 5.5) * 0.045 : 0);
          y += Math.sin(t * 0.65) * 0.018;
        }
      } else if (b.name.endsWith('Spine2') && !still) x = Math.sin(t * 1.8) * 0.006;
      else if (b.name.endsWith('RightArm')) {
        z = this.raised ? -0.8 : !still && this.mode === 'speaking' ? Math.sin(t * 1.9) * 0.07 : 0;
      } else if (b.name.endsWith('RightForeArm')) {
        x = this.raised ? -1 : !still && this.mode === 'speaking' ? -0.2 - Math.sin(t * 1.9) * 0.12 : 0;
      }
      b.quaternion.copy(base).multiply(rotation.setFromEuler(euler.set(x, y, z)));
    }
  }
}

type Props = {
  participants: Participant[];
  handles: { current: Map<string, AvatarHandle> };
  speakerId?: string | null;
  paused?: boolean;
  onFallback: () => void;
};

/** Un solo contexto WebGL para toda la comisión, con una vista por participante. */
export const HumanCommittee = memo(function HumanCommittee({
  participants,
  handles,
  speakerId,
  paused,
  onFallback,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const restart = useRef(() => {});
  const latest = useRef({ speakerId, paused });
  latest.current = { speakerId, paused };
  const [status, setStatus] = useState('Preparando participantes 3D en este equipo…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current!;
    let alive = true,
      raf = 0,
      previous = 0,
      ready = false,
      inView = true;
    let renderer: WebGLRenderer | null = null;
    let pkg: HumanPackage | null = null;
    const views: { id: string; scene: Scene; camera: PerspectiveCamera; rig: HumanRig }[] = [];
    const clear = () => {
      for (const v of views) {
        if (handles.current.get(v.id) === v.rig) handles.current.delete(v.id);
        const skeletons = new Set<SkinnedMesh['skeleton']>();
        v.rig.avatar.group.traverse((o) => {
          if (o instanceof SkinnedMesh) skeletons.add(o.skeleton);
        });
        for (const skeleton of skeletons) skeleton.dispose();
        v.rig.avatar.dispose();
        for (const b of v.rig.avatar.bones) b.parent?.remove(b);
      }
      views.length = 0;
      for (const texture of pkg?.textureCache.values() ?? [])
        void texture.then((t) => t.dispose()).catch(() => undefined);
      pkg?.textureCache.clear();
    };
    const fail = (error: unknown) => {
      if (!alive) return;
      setFailed(true);
      setStatus(
        `No se pudo mostrar la vista 3D: ${error instanceof Error ? error.message : 'WebGL no disponible'}.`,
      );
    };
    const lost = (event: Event) => {
      event.preventDefault();
      ready = false;
      fail(new Error('se perdió el contexto gráfico'));
    };
    const resize = () => renderer?.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight), false);
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const draw = (now: number) => {
      raf = 0;
      if (!alive || document.hidden || !inView) return;
      raf = requestAnimationFrame(draw);
      if (!ready || !renderer || now - previous < 1000 / 30) return;
      previous = now;
      const width = el.clientWidth,
        height = el.clientHeight;
      if (!width || !height) return;
      const still = reduced() || !!latest.current.paused;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
      views.forEach((view, i) => {
        const left = Math.round((width * i) / views.length);
        const right = Math.round((width * (i + 1)) / views.length);
        view.camera.aspect = (right - left) / height;
        view.camera.updateProjectionMatrix();
        view.rig.frame(now, still);
        renderer!.setViewport(left, 0, right - left, height);
        renderer!.setScissor(left, 0, right - left, height);
        renderer!.render(view.scene, view.camera);
      });
      if (latest.current.paused) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const visibility = () => {
      if (!document.hidden && inView && !raf) raf = requestAnimationFrame(draw);
    };
    const intersection = new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      if (inView) visibility();
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    intersection.observe(el);
    restart.current = visibility;
    document.addEventListener('visibilitychange', visibility);
    void (async () => {
      try {
        renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.addEventListener('webglcontextlost', lost);
        el.appendChild(renderer.domElement);
        resize();
        pkg = await loadHumanPackage(`${basePath}avatars/human`, {
          fetch: async (url) => {
            const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!response.ok) throw new Error(`no se pudo leer un recurso local (${response.status})`);
            return response.arrayBuffer();
          },
        });
        for (const [i, p] of participants.entries()) {
          if (!alive) break;
          const avatar = new HumanAvatar(pkg);
          avatar.textureSize = '1k';
          avatar.normalMaps = false;
          avatar.anisotropy = 1;
          try {
            await avatar.setConfig(humanLook(p.look, i));
          } catch (error) {
            avatar.dispose();
            throw error;
          }
          if (!alive) {
            avatar.dispose();
            break;
          }
          const scene = new Scene();
          const key = new DirectionalLight('#fff4e8', 2.5);
          key.position.set(1.2, 2.4, 3);
          const fill = new DirectionalLight('#dce6ff', 1.3);
          fill.position.set(-2, 1.9, 2);
          scene.add(avatar.group, key, fill, new HemisphereLight('#ffffff', '#adb3c2', 1.7));
          const headY = avatar.metrics().headY;
          const camera = new PerspectiveCamera(27, 1, 0.05, 20);
          camera.position.set(0, headY - 0.13, 1.85);
          camera.lookAt(new Vector3(0, headY - 0.2, 0));
          const rig = new HumanRig(avatar, p.temperament, i);
          rig.setMode(latest.current.speakerId === p.id ? 'speaking' : 'listening');
          views.push({ id: p.id, scene, camera, rig });
          handles.current.set(p.id, rig);
        }
        if (!alive) {
          clear();
          return;
        }
        ready = true;
        setStatus('');
        setFailed(false);
        raf = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    })();
    return () => {
      alive = false;
      restart.current = () => {};
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      renderer?.domElement.removeEventListener('webglcontextlost', lost);
      clear();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [participants, handles]);
  useEffect(() => {
    restart.current();
  }, [paused]);
  return (
    <div
      className="human-committee"
      role="group"
      aria-label={`Participantes 3D animados: ${participants.map((p) => p.name).join(', ')}`}
      data-ready={!status}
    >
      <div className="human-canvas" ref={host} />
      {status && (
        <div className="human-status" role={failed ? 'alert' : 'status'}>
          <p>{status}</p>
          {failed && (
            <button className="button secondary small" onClick={onFallback}>
              Usar participantes ilustrados
            </button>
          )}
        </div>
      )}
    </div>
  );
});
