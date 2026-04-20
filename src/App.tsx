import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Square, Loader2, Camera as CameraIcon, Play, Zap, Palette, Film, PersonStanding } from 'lucide-react';

const BODY_BONES = [
  { p: [11, 13], r: 0.16, w: 1.5 }, { p: [13, 15], r: 0.12, w: 1.2 }, // L arm
  { p: [12, 14], r: 0.16, w: 1.5 }, { p: [14, 16], r: 0.12, w: 1.2 }, // R arm
  { p: [23, 25], r: 0.22, w: 2.0 }, { p: [25, 27], r: 0.16, w: 1.8 }, // L leg
  { p: [24, 26], r: 0.22, w: 2.0 }, { p: [26, 28], r: 0.16, w: 1.8 }, // R leg
  { p: [11, 23], r: 0.35, w: 2.5 }, { p: [12, 24], r: 0.35, w: 2.5 }, // Torso sides
  { p: [11, 12], r: 0.28, w: 1.5 }, { p: [23, 24], r: 0.28, w: 1.5 }, // Torso top/bot
  { p: [8, 7], r: 0.35, w: 2.5 }                                      // Head (Ear to Ear)
];

// For each symmetric bone, maps to its mirror bone and the partner landmark indices.
// Used to detect side-view occlusion: when both bones overlap in 2D, whichever is
// further from the camera (higher z) gets its particles suppressed.
const BONE_PARTNER: Record<number, { partner: number; myIds: number[]; pIds: number[] }> = {
  0: { partner: 2, myIds: [11, 13], pIds: [12, 14] }, // L upper arm  <-> R upper arm
  2: { partner: 0, myIds: [12, 14], pIds: [11, 13] },
  1: { partner: 3, myIds: [13, 15], pIds: [14, 16] }, // L lower arm  <-> R lower arm
  3: { partner: 1, myIds: [14, 16], pIds: [13, 15] },
  4: { partner: 6, myIds: [23, 25], pIds: [24, 26] }, // L upper leg  <-> R upper leg
  6: { partner: 4, myIds: [24, 26], pIds: [23, 25] },
  5: { partner: 7, myIds: [25, 27], pIds: [26, 28] }, // L lower leg  <-> R lower leg
  7: { partner: 5, myIds: [26, 28], pIds: [25, 27] },
  8: { partner: 9, myIds: [11, 23], pIds: [12, 24] }, // L torso side <-> R torso side
  9: { partner: 8, myIds: [12, 24], pIds: [11, 23] },
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  
  const isAuraModeRef = useRef(false);
  const [isAuraMode, setIsAuraMode] = useState(false);
  const poseLmsRef = useRef<any>(null);
  const smoothedPoseLmsRef = useRef<any[]>([]);
  const smoothedRefScaleRef = useRef(0.2);
  
  const [showCamera, setShowCamera] = useState(true);
  const showCameraRef = useRef(true);

  const [colorSegmentation, setColorSegmentation] = useState(true);
  const colorSegmentationRef = useRef(true);

  const toggleColorSegmentation = () => {
    colorSegmentationRef.current = !colorSegmentationRef.current;
    setColorSegmentation(colorSegmentationRef.current);
  };

  const [normalVideoBg, setNormalVideoBg] = useState(false);
  const normalVideoBgRef = useRef(false);

  const toggleNormalVideoBg = () => {
    normalVideoBgRef.current = !normalVideoBgRef.current;
    setNormalVideoBg(normalVideoBgRef.current);
  };

  const [showSkeleton, setShowSkeleton] = useState(true);
  const showSkeletonRef = useRef(true);

  const toggleShowSkeleton = () => {
    showSkeletonRef.current = !showSkeletonRef.current;
    setShowSkeleton(showSkeletonRef.current);
  };

  const [spreadMultiplier, setSpreadMultiplier] = useState(1.0);
  const spreadMultiplierRef = useRef(1.0);

  const [volume, setVolume] = useState(0.8);
  const volumeRef = useRef(0.8);

  const [isVideoMode, setIsVideoMode] = useState(false);
  const isVideoModeRef = useRef(false);
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const uploadedVideoUrlRef = useRef<string | null>(null);
  const shouldMirrorRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  const toggleCamera = () => {
    showCameraRef.current = !showCameraRef.current;
    setShowCamera(showCameraRef.current);
  };
  
  const particlesRef = useRef<any[]>([]);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    maskCanvasRef.current = document.createElement('canvas');
    personCanvasRef.current = document.createElement('canvas');
  }, []);

  useEffect(() => {
    const pts: any[] = [];
    const totalWeight = BODY_BONES.reduce((sum, b) => sum + b.w, 0);

    for (let i = 0; i < 5500; i++) {
      let rand = Math.random() * totalWeight;
      let bIdx = 0;
      for (let j = 0; j < BODY_BONES.length; j++) {
          rand -= BODY_BONES[j].w;
          if (rand <= 0) { bIdx = j; break; }
      }
      pts.push({
        b: bIdx,
        t: Math.random(),
        ang: Math.random() * Math.PI * 2,
        phi: Math.acos(1 - 2 * Math.random()), // elevation angle for uniform 3D sphere distribution
        dist: 0,
        randDist: Math.random(),
        x: 0, y: 0, vx: 0, vy: 0, angle: 0, hist: [], active: false
      });
    }
    particlesRef.current = pts;
  }, []);

  const toggleAuraMode = () => {
    isAuraModeRef.current = !isAuraModeRef.current;
    setIsAuraMode(isAuraModeRef.current);
  };

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const hasStartedRef = useRef(false);
  const holisticRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  const initMediaPipe = async () => {
    setHasStarted(true);
    hasStartedRef.current = true;
    setError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not available. Ensure you are allowing permissions or using HTTPS.");
      }

      // Wait for MediaPipe scripts to load from CDN
      let retries = 0;
      while (!(window as any).Holistic && retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!(window as any).Holistic) {
        throw new Error("Failed to load MediaPipe Holistic");
      }

      const Holistic = (window as any).Holistic;

      const holistic = new Holistic({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`;
        }
      });

      holistic.setOptions({
        modelComplexity: 1, // Balanced accuracy – noticeably better side-view landmark placement
        smoothLandmarks: true,
        enableSegmentation: true, // Needed to cleanly separate user from background aura
        smoothSegmentation: true,
        refineFaceLandmarks: true, // Guarantees detailed tracking of fingers and face
        minDetectionConfidence: 0.5, // Lower so tracking survives partial side-on occlusion
        minTrackingConfidence: 0.5
      });

      holistic.onResults(onResults);
      holisticRef.current = holistic;

      // Extract raw native stream directly, bypassing strict mediapipe wrappers
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const processFrame = async () => {
          if (!hasStartedRef.current) return;
          if (videoRef.current && videoRef.current.readyState >= 2) {
             await holistic.send({ image: videoRef.current });
          }
          // Native unblocked asynchronous frame loop
          requestAnimationFrame(processFrame);
        };
        
        requestAnimationFrame(processFrame);
        setIsLoaded(true);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to access camera or load models.");
      setHasStarted(false);
      hasStartedRef.current = false;
    }
  };

  useEffect(() => {
    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
    };
  }, []);

  const stopHardwareCamera = () => {
    hasStartedRef.current = false;
    setHasStarted(false);
    setIsLoaded(false);
    isVideoModeRef.current = false;
    setIsVideoMode(false);
    shouldMirrorRef.current = true;
    setUploadedVideoName(null);
    smoothedPoseLmsRef.current = [];

    if (uploadedVideoUrlRef.current) {
      URL.revokeObjectURL(uploadedVideoUrlRef.current);
      uploadedVideoUrlRef.current = null;
    }
    
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
    
    // Hard destruction of holistic AI pipeline
    if (holisticRef.current) {
      holisticRef.current.close();
      holisticRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }

    if (videoRef.current && videoRef.current.src) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.load();
    }

    if (bgVideoRef.current && bgVideoRef.current.src) {
      bgVideoRef.current.pause();
      bgVideoRef.current.src = '';
      bgVideoRef.current.load();
    }
    
    // Clear canvas and restore default resolution
    if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        canvasRef.current.width = 1280;
        canvasRef.current.height = 720;
    }
  };

  const initVideoMode = async (file: File) => {
    // Stop any active session first
    if (hasStartedRef.current) {
      stopHardwareCamera();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setHasStarted(true);
    hasStartedRef.current = true;
    isVideoModeRef.current = true;
    setIsVideoMode(true);
    shouldMirrorRef.current = false; // Video plays as-is, no mirror
    setUploadedVideoName(file.name);
    setError(null);

    try {
      let retries = 0;
      while (!(window as any).Holistic && retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      if (!(window as any).Holistic) throw new Error('Failed to load MediaPipe Holistic');

      const url = URL.createObjectURL(file);
      uploadedVideoUrlRef.current = url;

      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.loop = true;
        videoRef.current.muted = false;
        videoRef.current.volume = volumeRef.current;
        videoRef.current.playsInline = true;
        // Wait for metadata so we know the real dimensions before playing
        await new Promise<void>(resolve => {
          const vid = videoRef.current!;
          if (vid.readyState >= 1) { resolve(); return; }
          vid.onloadedmetadata = () => resolve();
        });
        // Resize canvas to match video's native aspect ratio — no stretching
        if (canvasRef.current && videoRef.current.videoWidth && videoRef.current.videoHeight) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
        }
        await videoRef.current.play();
      }

      // Background fill video — same source, muted, loops in sync
      if (bgVideoRef.current) {
        bgVideoRef.current.src = url;
        bgVideoRef.current.loop = true;
        bgVideoRef.current.muted = true;
        bgVideoRef.current.playsInline = true;
        await bgVideoRef.current.play();
      }

      const Holistic = (window as any).Holistic;
      const holistic = new Holistic({
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`
      });
      holistic.setOptions({
        modelComplexity: 1,          // Higher accuracy for pre-recorded video
        smoothLandmarks: true,
        enableSegmentation: true,
        smoothSegmentation: true,
        refineFaceLandmarks: true,
        minDetectionConfidence: 0.5,  // Lower to survive partial occlusion & camera shake
        minTrackingConfidence: 0.5
      });
      holistic.onResults(onResults);
      holisticRef.current = holistic;

      const processFrame = async () => {
        if (!hasStartedRef.current) return;
        if (videoRef.current && videoRef.current.readyState >= 2 && !videoRef.current.paused) {
          await holistic.send({ image: videoRef.current });
        }
        requestAnimationFrame(processFrame);
      };
      requestAnimationFrame(processFrame);
      setIsLoaded(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to process video.');
      setHasStarted(false);
      hasStartedRef.current = false;
      isVideoModeRef.current = false;
      setIsVideoMode(false);
      shouldMirrorRef.current = true;
    }
  };

  const onResults = (results: any) => {
    if (!canvasRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const drawConnectors = (window as any).drawConnectors;
    const drawLandmarks = (window as any).drawLandmarks;
    const POSE_CONNECTIONS = (window as any).POSE_CONNECTIONS;
    const FACEMESH_TESSELATION = (window as any).FACEMESH_TESSELATION;
    const FACEMESH_RIGHT_EYE = (window as any).FACEMESH_RIGHT_EYE;
    const FACEMESH_RIGHT_EYEBROW = (window as any).FACEMESH_RIGHT_EYEBROW;
    const FACEMESH_LEFT_EYE = (window as any).FACEMESH_LEFT_EYE;
    const FACEMESH_LEFT_EYEBROW = (window as any).FACEMESH_LEFT_EYEBROW;
    const FACEMESH_FACE_OVAL = (window as any).FACEMESH_FACE_OVAL;
    const FACEMESH_LIPS = (window as any).FACEMESH_LIPS;
    const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // Flip the canvas horizontally for camera (mirror effect); skip for uploaded video
    if (shouldMirrorRef.current) {
      canvasCtx.translate(canvasRef.current.width, 0);
      canvasCtx.scale(-1, 1);
    }

    // Render video or black background
    if (showCameraRef.current) {
        if (isAuraModeRef.current && normalVideoBgRef.current) {
            // Normal video + particles: draw full-color video, slightly dimmed for particle contrast
            canvasCtx.filter = 'brightness(80%) contrast(105%)';
            canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            canvasCtx.filter = 'none';
        } else if (isVideoModeRef.current && isAuraModeRef.current) {
            // Video + aura: crush background to near-black so golden threads blaze against it
            canvasCtx.filter = 'grayscale(100%) contrast(160%) brightness(18%)';
            canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            canvasCtx.filter = 'none';
            // Additional atmospheric dark veil
            canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.40)';
            canvasCtx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        } else {
            canvasCtx.filter = 'grayscale(100%) contrast(110%) brightness(85%)';
            canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            canvasCtx.filter = 'none';
        }
    } else {
        canvasCtx.fillStyle = '#0f0f11';
        canvasCtx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    // Hide all 2D skeleton drawing and run particle physics when Fluid Aura is active
    if (isAuraModeRef.current) {
        if (results.poseLandmarks) {
            let pLms = results.poseLandmarks;
            const W = canvasRef.current.width;
            const H = canvasRef.current.height;

            // Temporally smooth landmarks for BOTH camera and video modes.
            // Camera (alpha=0.28): heavy smoothing absorbs jitter from side-view detection noise.
            // Video  (alpha=0.45): lighter smoothing preserves crisp motion in pre-recorded content.
            const alpha = isVideoModeRef.current ? 0.45 : 0.28;
            if (smoothedPoseLmsRef.current.length !== pLms.length) {
                smoothedPoseLmsRef.current = pLms.map((lm: any) => ({ ...lm }));
            } else {
                for (let i = 0; i < pLms.length; i++) {
                    const raw = pLms[i];
                    const s = smoothedPoseLmsRef.current[i];
                    s.x += (raw.x - s.x) * alpha;
                    s.y += (raw.y - s.y) * alpha;
                    s.z  = (s.z  || 0) + ((raw.z  || 0) - (s.z  || 0)) * alpha;
                    const rv = raw.visibility ?? 1;
                    s.visibility = (s.visibility ?? rv) + (rv - (s.visibility ?? rv)) * 0.3;
                }
            }
            pLms = smoothedPoseLmsRef.current;
            
            const shoulder1 = pLms[11];
            const shoulder2 = pLms[12];
            const hip1 = pLms[23];
            const hip2 = pLms[24];
            
            // To maintain a 360 degree sphere volume from all angles, we must use a robust
            // body measurement that doesn't shrink when viewed from the side. 
            // Torso height is much more stable than shoulder width when turning!
            let refScale = 0.2; 
            if (shoulder1 && shoulder2 && hip1 && hip2) {
                const headToTorsoMidX = (shoulder1.x + shoulder2.x) / 2;
                const headToTorsoMidY = (shoulder1.y + shoulder2.y) / 2;
                const hipMidX = (hip1.x + hip2.x) / 2;
                const hipMidY = (hip1.y + hip2.y) / 2;
                const torsoHeight = Math.hypot(headToTorsoMidX - hipMidX, headToTorsoMidY - hipMidY);
                refScale = torsoHeight * 0.7; // Calibrated to create an aura slightly wider than the body
            } else if (shoulder1 && shoulder2) {
                const dx = shoulder1.x - shoulder2.x;
                const dy = shoulder1.y - shoulder2.y;
                refScale = Math.sqrt(dx*dx + dy*dy);
            }
            // EMA-smooth refScale so scale changes glide rather than snap.
            // Faster blend in video mode; slower in camera mode to absorb detection jitter.
            const rsAlpha = isVideoModeRef.current ? 0.30 : 0.18;
            smoothedRefScaleRef.current += (refScale - smoothedRefScaleRef.current) * rsAlpha;
            refScale = smoothedRefScaleRef.current;
            
            const time = Date.now() * 0.001;
            
            particlesRef.current.forEach(p => {
               const bone = BODY_BONES[p.b];
               const p1 = pLms[bone.p[0]];
               const p2 = pLms[bone.p[1]];
               
               if (!p1 || !p2) { p.active = false; p.hist = []; return; }

               // --- Depth-occlusion suppression for side views ---
               // When two symmetric limbs (e.g. left/right leg) overlap in 2D screen space
               // because the body is turned sideways, we use the z-depth reported by MediaPipe
               // to determine which is the "back" limb and gradually suppress its particles.
               // This prevents the characteristic side-view oscillation where particles
               // visibly jump back and forth between the front and back leg.
               let depthTarget = 1.0;
               const pairInfo = BONE_PARTNER[p.b];
               if (pairInfo) {
                   const pp1 = pLms[pairInfo.pIds[0]];
                   const pp2 = pLms[pairInfo.pIds[1]];
                   if (pp1 && pp2) {
                       const myMidX  = (p1.x + p2.x) / 2;
                       const pMidX   = (pp1.x + pp2.x) / 2;
                       const myMidZ  = ((p1.z || 0) + (p2.z || 0)) / 2;
                       const pMidZ   = ((pp1.z || 0) + (pp2.z || 0)) / 2;
                       // xOverlap rises from 0 (frontal view) to 1 (fully side-on) based on
                       // how close the two bones are horizontally in normalized screen coords.
                       const xOverlap = Math.max(0, 1 - Math.abs(myMidX - pMidX) / 0.12);
                       if (xOverlap > 0.25 && myMidZ > pMidZ) {
                           // This bone is behind its partner. Scale suppression by both
                           // the overlap amount and the z-separation so it fades smoothly.
                           const zDiff = Math.min(1, (myMidZ - pMidZ) * 25);
                           depthTarget = 1 - xOverlap * zDiff * 0.92;
                       }
                   }
               }
               // EMA-smooth the suppression value so transitions are gradual, not instant.
               if (p.depthSup === undefined) p.depthSup = 1.0;
               p.depthSup += (depthTarget - p.depthSup) * 0.15;

               // Smooth visibility per-particle with hysteresis to prevent flicker.
               // Use a slower blend for live camera so particles don't flicker when
               // a landmark briefly dips below threshold during side-on turns.
               const rawVis = Math.min(p1.visibility ?? 1, p2.visibility ?? 1) * p.depthSup;
               if (p.vis === undefined) p.vis = rawVis;
               p.vis += (rawVis - p.vis) * (isVideoModeRef.current ? 0.18 : 0.30);
               // Hysteresis: lower thresholds so particles survive partial side-on occlusion.
               const onThresh  = p.active ? 0.06 : 0.14;
               if (p.vis < onThresh) {
                   if (!p.active) return;
                   p.active = false; p.hist = []; return;
               }
               p.active = true;
               
               const p1x = p1.x * W; const p1y = p1.y * H;
               const p2x = p2.x * W; const p2y = p2.y * H;
               
               const dx = p2x - p1x; const dy = p2y - p1y;
               // Bump base thickness outwards slightly so trails clearly trace the exact camera contour 
               // instead of clipping under the segmentation mask
               const baseThickness = bone.w * refScale * W * 0.23 * spreadMultiplierRef.current;
               // Minimal spread so particles sit tightly right on the exterior edges
               const auraSpread = refScale * W * 0.15 * spreadMultiplierRef.current;
               
               // Soft taper at bone ends
               const taper = Math.sin(p.t * Math.PI);
               const actualThickness = baseThickness * (0.6 + 0.4 * taper);
               
               const normalizedDist = p.randDist !== undefined ? p.randDist : Math.random();
               // Concentrate particles immediately outside the skin with a hard exponential dropoff
               const distFromSkin = Math.pow(normalizedDist, 2.5) * auraSpread;
               
               const rRadius = actualThickness + distFromSkin;
               
               // 3D spherical distribution: ang = azimuth, phi = elevation (uniform sphere)
               const sinPhi3d = Math.sin(p.phi);
               const cosPhi3d = Math.cos(p.phi);
               // Screen-plane (XY) spread via spherical coords
               const off3dX = Math.cos(p.ang) * sinPhi3d * rRadius;
               const off3dY = Math.sin(p.ang) * sinPhi3d * rRadius;
               // Depth (Z) component projected to 2D via isometric offset — creates wrap-around 3D illusion
               const depth3d = cosPhi3d * rRadius;
               let tx = p1x + dx * p.t + off3dX + depth3d * 0.20;
               let ty = p1y + dy * p.t + off3dY + depth3d * 0.38;
               
               // Movement Delta calculation for Dynamic Trailing
               const distToTarget = Math.hypot(tx - p.x, ty - p.y);
               
               // Adaptive lerp: landmark targets are now smoothed in both modes, so camera
               // no longer needs the aggressive 0.85 snap — 0.70 gives fluid following.
               const lerpFactor = isVideoModeRef.current ? 0.55 : 0.70;
               p.x += (tx - p.x) * lerpFactor;
               p.y += (ty - p.y) * lerpFactor;
               
               // Orientation follows the projected 2D direction of the 3D radial offset
               const targetAngle = Math.atan2(off3dY + depth3d * 0.38, off3dX + depth3d * 0.20);
               
               let aDiff = targetAngle - p.angle;
               while (aDiff > Math.PI) aDiff -= Math.PI * 2;
               while (aDiff < -Math.PI) aDiff += Math.PI * 2;
               p.angle += aDiff * 0.8; // Fast orientation snap
               
               // Teleport guard (STRICT: prevents massive streaks shown in screenshot when tracking hallucinates)
               if (distToTarget > W * 0.08) {
                   p.x = tx; p.y = ty;
                   p.hist = []; // Instant history wipe on leaps
               }
               
               // Creative Redesign: Pulsating elegant energy flares instead of static flat sticks
               const pulse = Math.sin(time * 6 + normalizedDist * 100) * 0.5 + 0.5;
               const baseStickLen = refScale * W * 0.011 + (1.0 - normalizedDist) * refScale * W * 0.013; 
               const stickLen = baseStickLen * (0.55 + 0.45 * pulse); // Scintillate
               
               p.stickLen = stickLen;
               
               if (!p.hist) p.hist = [];
               
               // If the user actively moves, draw trailing comets. Otherwise, shrink back to iron filings.
               if (distToTarget > W * 0.003) {
                   p.hist.push({x: p.x, y: p.y, angle: p.angle, len: stickLen});
                   if (p.hist.length > 3) p.hist.shift(); // Short tail = tight crisp comets
               } else {
                   // Standing still: gracefully melt the trail history
                   if (p.hist.length > 0) p.hist.shift();
               }
            });
            
            canvasCtx.lineCap = 'round';
            
            // Creative Energy Thread Rendering (Aerodynamic and sharp)
            const drawTrails = (width: number, color: string) => {
                canvasCtx.lineWidth = width;
                canvasCtx.strokeStyle = color;
                canvasCtx.beginPath();
                
                const ptcl = particlesRef.current;
                for (let i = 0; i < ptcl.length; i++) {
                    const p = ptcl[i];
                    if (!p.active) continue;
                    
                    if (p.hist && p.hist.length >= 2) {
                        // Supreme glitch guard: if any particle moves impossibly far between frames, skip rendering its trail entirely.
                        let glitchDetected = false;
                        for (let j = 1; j < p.hist.length; j++) {
                            if (Math.hypot(p.hist[j].x - p.hist[j-1].x, p.hist[j].y - p.hist[j-1].y) > Math.max(50, W * 0.07)) {
                                glitchDetected = true;
                                break;
                            }
                        }
                        if (glitchDetected) {
                            p.hist = []; // Nuke the corrupted history
                            continue;
                        }

                        // Tail tapers dynamically to look like a flying spark
                        const tailNode = p.hist[0];
                        const tailX = tailNode.x - Math.cos(tailNode.angle) * tailNode.len * 0.2;
                        const tailY = tailNode.y - Math.sin(tailNode.angle) * tailNode.len * 0.2;
                        
                        canvasCtx.moveTo(tailX, tailY);
                        
                        for (let j = 1; j < p.hist.length; j++) {
                            canvasCtx.lineTo(p.hist[j].x, p.hist[j].y);
                        }
                        
                        // Head elongates sharply out of the core
                        const headX = p.x + Math.cos(p.angle) * p.stickLen * 0.7;
                        const headY = p.y + Math.sin(p.angle) * p.stickLen * 0.7;
                        canvasCtx.lineTo(headX, headY);
                    } else {
                        // Stationary: Render strictly as neat, unmoving iron filings
                        const tailX = p.x - Math.cos(p.angle) * p.stickLen * 0.5;
                        const tailY = p.y - Math.sin(p.angle) * p.stickLen * 0.5;
                        const headX = p.x + Math.cos(p.angle) * p.stickLen * 0.5;
                        const headY = p.y + Math.sin(p.angle) * p.stickLen * 0.5;
                        
                        canvasCtx.moveTo(tailX, tailY);
                        canvasCtx.lineTo(headX, headY);
                    }
                }
                canvasCtx.stroke();
            };
            
            if (particlesRef.current.length > 0) {
                const inVideoAura = isVideoModeRef.current;
                // Soft outer glow halo
                drawTrails(inVideoAura ? 10.0 : 7.0, inVideoAura ? 'rgba(255, 75, 10, 0.07)' : 'rgba(255, 75, 10, 0.03)');
                
                // Core amber threads — toned down so they don't blow out
                drawTrails(2.0, inVideoAura ? 'rgba(255, 150, 20, 0.42)' : 'rgba(255, 140, 20, 0.22)');
                
                // Fine filament tips — reduced from 0.9 to keep whites subtle
                drawTrails(0.7, 'rgba(255, 255, 255, 0.55)');

                // Delicate golden rim — video only
                if (inVideoAura) {
                    drawTrails(1.2, 'rgba(255, 200, 70, 0.28)');
                }
            }
            
            // Render the person cutout on top of aura threads with crisp, HD edges.
            if (results.segmentationMask && maskCanvasRef.current && personCanvasRef.current) {
                const mCanvas = maskCanvasRef.current;
                const pCanvas = personCanvasRef.current;
                mCanvas.width = W; mCanvas.height = H;
                pCanvas.width = W; pCanvas.height = H;

                const mCtx = mCanvas.getContext('2d');
                const pCtx = pCanvas.getContext('2d');
                if (mCtx && pCtx) {

                    // ── Stage 1: Build a clean, anti-aliased alpha mask ──────────────────
                    // Upscale the (potentially low-res) mask with high-quality interpolation.
                    // blur(5px) softens blocky pixel edges into a gradient;
                    // contrast(28) then snaps that gradient back to near-binary BUT with
                    // smooth sub-pixel transitions AND slight inward erosion — erasing the
                    // ambiguous boundary pixels that were picking up background color.
                    // brightness(1.2) brightens the mask interior so detection holes fill in.
                    mCtx.clearRect(0, 0, W, H);
                    mCtx.imageSmoothingEnabled = true;
                    (mCtx as any).imageSmoothingQuality = 'high';
                    mCtx.filter = 'blur(5px) contrast(28) brightness(1.2)';
                    mCtx.drawImage(results.segmentationMask, 0, 0, W, H);
                    mCtx.filter = 'none';

                    // ── Stage 2: Draw color-treated person, then stamp mask as alpha ──────
                    // Draw the full-resolution image FIRST (color filters applied here,
                    // before clipping) so filter processing never touches edge alpha pixels.
                    pCtx.clearRect(0, 0, W, H);
                    pCtx.imageSmoothingEnabled = true;
                    (pCtx as any).imageSmoothingQuality = 'high';

                    if (showCameraRef.current) {
                        const colorFilter = colorSegmentationRef.current
                            ? (isVideoModeRef.current
                                ? 'saturate(200%) brightness(112%) contrast(112%)'
                                : 'saturate(170%) brightness(108%) contrast(108%)')
                            : 'grayscale(100%) brightness(118%) contrast(128%)';
                        pCtx.filter = colorFilter;
                        pCtx.drawImage(results.image, 0, 0, W, H);
                        pCtx.filter = 'none';
                    } else {
                        pCtx.fillStyle = colorSegmentationRef.current
                            ? 'rgba(130, 130, 155, 0.80)'
                            : 'rgba(160, 160, 160, 0.75)';
                        pCtx.fillRect(0, 0, W, H);
                    }

                    // Use destination-in to mask out the background:
                    // pixels on personCanvas are kept only where mCanvas (the mask) is opaque.
                    // Critically this happens AFTER color processing, so filter bleed is impossible.
                    pCtx.globalCompositeOperation = 'destination-in';
                    pCtx.drawImage(mCanvas, 0, 0, W, H);
                    pCtx.globalCompositeOperation = 'source-over';

                    canvasCtx.drawImage(pCanvas, 0, 0, W, H);
                }
            }

            // Skeleton overlay on top of aura when toggled
            if (showSkeletonRef.current) {
                if (results.poseLandmarks && drawConnectors && drawLandmarks && POSE_CONNECTIONS) {
                    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
                                   {color: 'rgba(255, 255, 255, 0.35)', lineWidth: 2});
                    const sp = results.poseLandmarks;
                    canvasCtx.beginPath();
                    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                    canvasCtx.lineWidth = 1;
                    const dtl = (a: number, b: number) => {
                        const l1 = sp[a]; const l2 = sp[b];
                        if (l1 && l2 && (l1.visibility ?? 1) > 0.5 && (l2.visibility ?? 1) > 0.5 && canvasRef.current) {
                            canvasCtx.moveTo(l1.x * canvasRef.current.width, l1.y * canvasRef.current.height);
                            canvasCtx.lineTo(l2.x * canvasRef.current.width, l2.y * canvasRef.current.height);
                        }
                    };
                    dtl(11,24); dtl(12,23); dtl(15,12); dtl(16,11); dtl(13,23); dtl(14,24);
                    canvasCtx.stroke();
                    drawLandmarks(canvasCtx, results.poseLandmarks,
                                  {color: 'rgba(255, 255, 255, 0.7)', fillColor: '#000000', lineWidth: 1.5, radius: 3});
                }
                if (results.faceLandmarks && drawConnectors && FACEMESH_TESSELATION) {
                    drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION,
                                   {color: 'rgba(255, 255, 255, 0.08)', lineWidth: 0.5});
                    if (FACEMESH_RIGHT_EYE) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_RIGHT_EYE, {color: 'rgba(255,255,255,0.35)', lineWidth: 1});
                    if (FACEMESH_LEFT_EYE) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_LEFT_EYE, {color: 'rgba(255,255,255,0.35)', lineWidth: 1});
                    if (FACEMESH_FACE_OVAL) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_FACE_OVAL, {color: 'rgba(255,255,255,0.25)', lineWidth: 1.5});
                    if (FACEMESH_LIPS) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_LIPS, {color: 'rgba(255,255,255,0.35)', lineWidth: 1});
                }
                if (results.leftHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
                    drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, {color: 'rgba(255,255,255,0.5)', lineWidth: 1.5});
                    drawLandmarks(canvasCtx, results.leftHandLandmarks, {color: 'rgba(255,255,255,1)', fillColor: '#000000', lineWidth: 1, radius: 2});
                }
                if (results.rightHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
                    drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, {color: 'rgba(255,255,255,0.5)', lineWidth: 1.5});
                    drawLandmarks(canvasCtx, results.rightHandLandmarks, {color: 'rgba(255,255,255,1)', fillColor: '#000000', lineWidth: 1, radius: 2});
                }
            }
        }
      canvasCtx.restore();
      return;
    }

    // Grey body silhouette in hide-video + normal skeleton mode
    if (!showCameraRef.current && results.segmentationMask && maskCanvasRef.current && canvasRef.current) {
      const sW = canvasRef.current.width;
      const sH = canvasRef.current.height;
      const mCanvas = maskCanvasRef.current;
      mCanvas.width = sW;
      mCanvas.height = sH;
      const mCtx = mCanvas.getContext('2d');
      if (mCtx) {
        mCtx.clearRect(0, 0, sW, sH);
        mCtx.drawImage(results.segmentationMask, 0, 0, sW, sH);
        mCtx.globalCompositeOperation = 'source-in';
        mCtx.fillStyle = 'rgba(110, 110, 130, 0.65)';
        mCtx.fillRect(0, 0, sW, sH);
        mCtx.globalCompositeOperation = 'source-over';
        canvasCtx.drawImage(mCanvas, 0, 0, sW, sH);
      }
    }
    
    // Draw Pose
    if (showSkeletonRef.current && results.poseLandmarks && drawConnectors && drawLandmarks && POSE_CONNECTIONS) {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
                     {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 2});
      
      // Draw additional high-tech cross-body tracking vectors
      const p = results.poseLandmarks;
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      canvasCtx.lineWidth = 1;
      
      const drawTechLine = (p1Id: number, p2Id: number) => {
        const p1 = p[p1Id];
        const p2 = p[p2Id];
        if (p1 && p2 && p1.visibility && p1.visibility > 0.5 && p2.visibility && p2.visibility > 0.5) {
          if (canvasRef.current) {
            canvasCtx.moveTo(p1.x * canvasRef.current.width, p1.y * canvasRef.current.height);
            canvasCtx.lineTo(p2.x * canvasRef.current.width, p2.y * canvasRef.current.height);
          }
        }
      };

      // Create a geometric web across the torso
      drawTechLine(11, 24); // Left shoulder to right hip
      drawTechLine(12, 23); // Right shoulder to left hip
      drawTechLine(15, 12); // Left wrist to right shoulder
      drawTechLine(16, 11); // Right wrist to left shoulder
      drawTechLine(13, 23); // Left elbow to left hip
      drawTechLine(14, 24); // Right elbow to right hip
      canvasCtx.stroke();

      drawLandmarks(canvasCtx, results.poseLandmarks,
                    {color: 'rgba(255, 255, 255, 0.8)', fillColor: '#000000', lineWidth: 1.5, radius: 3});
    }

    // Draw Face
    if (showSkeletonRef.current && results.faceLandmarks && drawConnectors && FACEMESH_TESSELATION) {
      // Draw the dense interconnected mesh
      drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION,
                     {color: 'rgba(255, 255, 255, 0.1)', lineWidth: 0.5});
      
      // Highlight specific facial features
      if (FACEMESH_RIGHT_EYE) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_RIGHT_EYE, {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1});
      if (FACEMESH_RIGHT_EYEBROW) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_RIGHT_EYEBROW, {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1});
      if (FACEMESH_LEFT_EYE) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_LEFT_EYE, {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1});
      if (FACEMESH_LEFT_EYEBROW) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_LEFT_EYEBROW, {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1});
      if (FACEMESH_FACE_OVAL) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_FACE_OVAL, {color: 'rgba(255, 255, 255, 0.3)', lineWidth: 1.5});
      if (FACEMESH_LIPS) drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_LIPS, {color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1});

      // Render all 468 facial landmark points individually
      drawLandmarks(canvasCtx, results.faceLandmarks,
                    {color: 'rgba(255, 255, 255, 0.3)', fillColor: '#000000', lineWidth: 0.5, radius: 0.8});
    }

    // Draw Left Hand
    if (showSkeletonRef.current && results.leftHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
      drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS,
                     {color: 'rgba(255, 255, 255, 0.6)', lineWidth: 1.5});
      drawLandmarks(canvasCtx, results.leftHandLandmarks,
                    {color: 'rgba(255, 255, 255, 1)', fillColor: '#000000', lineWidth: 1, radius: 2});
    }

    // Draw Right Hand
    if (showSkeletonRef.current && results.rightHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
      drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS,
                     {color: 'rgba(255, 255, 255, 0.6)', lineWidth: 1.5});
      drawLandmarks(canvasCtx, results.rightHandLandmarks,
                    {color: 'rgba(255, 255, 255, 1)', fillColor: '#000000', lineWidth: 1, radius: 2});
    }

    canvasCtx.restore();
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = () => {
    if (!canvasRef.current) return;
    
    recordedChunksRef.current = [];
    const stream = canvasRef.current.captureStream(30);
    
    try {
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp9'
      });
    } catch (e) {
      // Fallback for browsers that don't support vp9
      mediaRecorderRef.current = new MediaRecorder(stream);
    }

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, {
        type: 'video/webm'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = `quantum-pose-${Date.now()}.webm`;
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    };

    mediaRecorderRef.current.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden font-sans selection:bg-white selection:text-black">
      {/* Hidden video element for MediaPipe input */}
      <video 
        ref={videoRef} 
        className="hidden" 
        playsInline 
      />

      {/* Background fill — blurred video frame covers the full UI when aspect ratio leaves gaps */}
      <video
        ref={bgVideoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: 'grayscale(100%) blur(32px) brightness(55%)',
          transform: 'scale(1.1)',
          zIndex: 0,
          display: isVideoMode ? 'block' : 'none',
        }}
        playsInline
        muted
        loop
      />

      {/* Hidden file input for video upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) initVideoMode(file);
          e.target.value = '';
        }}
      />

      {/* Main Canvas */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="opacity-90"
          style={isVideoMode
            ? { width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }
            : { width: '100%', height: '100%', objectFit: 'cover' }
          }
        />
      </div>

      {/* Overlay UI */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
        
        {/* Top Area */}
        <div className="flex justify-between items-start z-10 w-full">
          {/* Top Left: Header */}
          <div className="flex flex-col gap-0.5">
            <h1 className="text-base font-medium tracking-[0.15em] uppercase text-white/80">
              Magnetic Aura
            </h1>
            <p className="text-[10px] text-white/30 tracking-[0.2em] uppercase">
              Kinematic Tracking
            </p>
          </div>
          
          {/* Top Right: Stop Hardware Camera */}
          {hasStarted && (
            <button
               onClick={stopHardwareCamera}
               className="pointer-events-auto flex items-center justify-center w-7 h-7 border border-white/10 bg-transparent text-white/30 hover:text-red-400 hover:border-red-500/30 transition-all rounded"
               title="Stop Camera"
            >
               <Square className="w-3 h-3 fill-current" />
            </button>
          )}
        </div>

        {/* Center: Loading / Error States */}
        {!hasStarted && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-20 pointer-events-auto">
            <div className="text-center max-w-xs px-6">
              <h2 className="text-xs tracking-[0.25em] uppercase text-white/50 mb-7">Choose Input</h2>
              <div className="flex items-center gap-3 justify-center">
                <button 
                  onClick={initMediaPipe}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3 border border-white/20 text-white text-xs tracking-[0.2em] uppercase hover:border-white/50 hover:bg-white/5 transition-all duration-200"
                >
                  <Play className="w-3 h-3 fill-white" />
                  Camera
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3 border border-white/20 text-white text-xs tracking-[0.2em] uppercase hover:border-white/50 hover:bg-white/5 transition-all duration-200"
                  title="Upload a video file"
                >
                  <span className="text-sm leading-none">+</span>
                  Video
                </button>
              </div>
            </div>
          </div>
        )}

        {hasStarted && !isLoaded && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-20 pointer-events-auto">
            <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            <p className="text-[10px] tracking-[0.25em] uppercase text-white/30">Initializing</p>
            
            <div className="mt-6 text-center max-w-xs px-4">
              <p className="text-[10px] text-white/20 mb-3">
                If no permission prompt appears, try opening in a new tab.
              </p>
              <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="px-4 py-1.5 border border-white/10 text-white/30 text-[10px] tracking-[0.2em] uppercase hover:border-white/20 hover:text-white/50 transition-colors"
              >
                Open in New Tab
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-20 px-6 text-center pointer-events-auto">
            <CameraIcon className="w-6 h-6 text-white/20 mb-1" />
            <p className="text-sm text-white/60 max-w-sm">{error}</p>
            <p className="text-[10px] text-white/25 max-w-sm mb-4">
              Camera access may be blocked inside embedded frames. Try opening in a new tab.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="px-5 py-2 border border-white/10 text-white/40 text-[10px] tracking-[0.2em] uppercase hover:border-white/20 hover:text-white/60 transition-colors"
              >
                Retry
              </button>
              <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="px-5 py-2 border border-white/20 text-white/60 text-[10px] tracking-[0.2em] uppercase hover:border-white/40 hover:text-white/80 transition-colors"
              >
                Open in New Tab
              </button>
            </div>
          </div>
        )}

        {/* Bottom Section */}
        <div className="flex justify-between items-end w-full z-10">
          
          {/* Controls */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Record button */}
            <button
              onClick={toggleRecording}
              disabled={!isLoaded}
              title={isRecording ? 'Stop Recording' : 'Start Recording'}
              className={`relative flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                isRecording 
                  ? 'border-red-500/60 text-red-500' 
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              } disabled:opacity-20 disabled:cursor-not-allowed`}
            >
              {isRecording ? (
                <Square className="w-3 h-3 fill-red-500" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-current" />
              )}
              {isRecording && (
                <span className="absolute inset-0 border border-red-500/40 animate-ping" />
              )}
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Skeleton mode button */}
            <button
              onClick={toggleShowSkeleton}
              disabled={!isLoaded}
              title={showSkeleton ? 'Hide Skeleton' : 'Show Skeleton'}
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                showSkeleton
                  ? 'border-cyan-500/60 text-cyan-400'
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              } disabled:opacity-20 disabled:cursor-not-allowed`}
            >
              <PersonStanding className={`w-3.5 h-3.5 ${showSkeleton ? 'fill-cyan-400' : ''} transition-all duration-300`} />
            </button>

            {/* Aura mode button */}
            <button
              onClick={toggleAuraMode}
              disabled={!isLoaded}
              title="Toggle Fluid Aura"
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                isAuraMode
                  ? 'border-orange-500/60 text-orange-400' 
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              } disabled:opacity-20 disabled:cursor-not-allowed`}
            >
              <Zap className={`w-3.5 h-3.5 ${isAuraMode ? 'fill-orange-400' : ''} transition-all duration-300`} />
            </button>

            {/* Camera toggle button */}
            <button
              onClick={toggleCamera}
              disabled={!isLoaded}
              title={showCamera ? 'Hide Video' : 'Show Video'}
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 border-white/15 hover:border-white/30 disabled:opacity-20 disabled:cursor-not-allowed ${
                showCamera ? 'text-white/40 hover:text-white/70' : 'text-white/20 hover:text-white/40'
              }`}
            >
              <CameraIcon className="w-3.5 h-3.5" />
            </button>

            {/* Color / B&W segmentation toggle */}
            <button
              onClick={toggleColorSegmentation}
              disabled={!isLoaded || !isAuraMode}
              title={colorSegmentation ? 'Switch to Black & White' : 'Switch to Color'}
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                colorSegmentation
                  ? 'border-violet-500/60 text-violet-400'
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              } disabled:opacity-20 disabled:cursor-not-allowed`}
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {/* Normal video + particles toggle */}
            <button
              onClick={toggleNormalVideoBg}
              disabled={!isLoaded || !isAuraMode}
              title={normalVideoBg ? 'Dark Background Mode' : 'Normal Video + Particles'}
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                normalVideoBg
                  ? 'border-emerald-500/60 text-emerald-400'
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              } disabled:opacity-20 disabled:cursor-not-allowed`}
            >
              <Film className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Upload video button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              title={isVideoMode && uploadedVideoName ? `Video: ${uploadedVideoName}` : 'Upload Video'}
              className={`flex items-center justify-center w-8 h-8 border transition-all duration-300 ${
                isVideoMode
                  ? 'border-sky-500/60 text-sky-400'
                  : 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/70'
              }`}
            >
              <span className="text-base leading-none font-light">+</span>
            </button>
          </div>

          {/* Bottom Right: Signature + sliders */}
          <div className="text-right flex flex-col items-end gap-2">
            {/* Volume slider — only visible in video mode */}
            {isVideoMode && isLoaded && (
              <div className="flex items-center gap-2 pointer-events-auto">
                <span className="text-[9px] tracking-[0.18em] uppercase text-white/25 select-none">Vol</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    volumeRef.current = v;
                    setVolume(v);
                    if (videoRef.current) videoRef.current.volume = v;
                  }}
                  className="w-24 h-0.5 appearance-none bg-white/10 rounded-full outline-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400
                    [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5
                    [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-sky-400
                    [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                />
                <span className="text-[9px] font-mono text-white/25 w-6 text-left select-none">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            )}
            {/* Particle spread slider — only visible in aura mode */}
            {isAuraMode && isLoaded && (
              <div className="flex items-center gap-2 pointer-events-auto">
                <span className="text-[9px] tracking-[0.18em] uppercase text-white/25 select-none">Spread</span>
                <input
                  type="range"
                  min={0.3}
                  max={5.0}
                  step={0.05}
                  value={spreadMultiplier}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    spreadMultiplierRef.current = v;
                    setSpreadMultiplier(v);
                  }}
                  className="w-24 h-0.5 appearance-none bg-white/10 rounded-full outline-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-400
                    [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5
                    [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-orange-400
                    [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                />
                <span className="text-[9px] font-mono text-white/25 w-6 text-left select-none">
                  {spreadMultiplier.toFixed(1)}x
                </span>
              </div>
            )}
            <p className="text-[10px] font-mono text-white/20 tracking-tight hover:text-white/40 transition-colors duration-300 cursor-default">
              &lt;/Shahnab&gt;
            </p>
          </div>

        </div>
      </div>

      {/* Decorative Grid / Scanlines */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay" 
           style={{ backgroundImage: 'linear-gradient(transparent 50%, rgba(0, 0, 0, 1) 50%)', backgroundSize: '100% 4px' }} />
    </div>
  );
}
