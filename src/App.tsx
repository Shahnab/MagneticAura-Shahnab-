import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Square, Loader2, Camera as CameraIcon, Play, Zap } from 'lucide-react';

const BODY_BONES = [
  { p: [11, 13], r: 0.16, w: 1.5 }, { p: [13, 15], r: 0.12, w: 1.2 }, // L arm
  { p: [12, 14], r: 0.16, w: 1.5 }, { p: [14, 16], r: 0.12, w: 1.2 }, // R arm
  { p: [23, 25], r: 0.22, w: 2.0 }, { p: [25, 27], r: 0.16, w: 1.8 }, // L leg
  { p: [24, 26], r: 0.22, w: 2.0 }, { p: [26, 28], r: 0.16, w: 1.8 }, // R leg
  { p: [11, 23], r: 0.35, w: 2.5 }, { p: [12, 24], r: 0.35, w: 2.5 }, // Torso sides
  { p: [11, 12], r: 0.28, w: 1.5 }, { p: [23, 24], r: 0.28, w: 1.5 }, // Torso top/bot
  { p: [8, 7], r: 0.35, w: 2.5 }                                      // Head (Ear to Ear)
];

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
  
  const [showCamera, setShowCamera] = useState(true);
  const showCameraRef = useRef(true);

  const toggleCamera = () => {
    showCameraRef.current = !showCameraRef.current;
    setShowCamera(showCameraRef.current);
  };
  
  const particlesRef = useRef<any[]>([]);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    maskCanvasRef.current = document.createElement('canvas');
  }, []);

  useEffect(() => {
    const pts: any[] = [];
    const totalWeight = BODY_BONES.reduce((sum, b) => sum + b.w, 0);

    for (let i = 0; i < 3360; i++) {
      let rand = Math.random() * totalWeight;
      let bIdx = 0;
      for (let j = 0; j < BODY_BONES.length; j++) {
          rand -= BODY_BONES[j].w;
          if (rand <= 0) { bIdx = j; break; }
      }
      pts.push({
        b: bIdx,
        t: Math.random(),
        ang: Math.random() * Math.PI * 2, // 2D spread around the bone
        dist: 0,
        randDist: Math.random(), // Clean 0 to 1 distribution for clustering
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
        modelComplexity: 0, // 0 prioritizes speed and real-time performance to eliminate lag
        smoothLandmarks: true,
        enableSegmentation: true, // Needed to cleanly separate user from background aura
        smoothSegmentation: true,
        refineFaceLandmarks: true, // Guarantees detailed tracking of fingers and face
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
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
    
    // Clear canvas safely
    if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
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
    
    // Flip the canvas horizontally to create a mirror effect
    canvasCtx.translate(canvasRef.current.width, 0);
    canvasCtx.scale(-1, 1);

    // Render video or black background
    if (showCameraRef.current) {
        canvasCtx.filter = 'grayscale(100%) contrast(110%) brightness(85%)';
        canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
        canvasCtx.filter = 'none';
    } else {
        canvasCtx.fillStyle = '#0f0f11';
        canvasCtx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    // Hide all 2D skeleton drawing and run particle physics when Fluid Aura is active
    if (isAuraModeRef.current) {
        if (results.poseLandmarks) {
            const pLms = results.poseLandmarks;
            const W = canvasRef.current.width;
            const H = canvasRef.current.height;
            
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
            
            const time = Date.now() * 0.001;
            
            particlesRef.current.forEach(p => {
               const bone = BODY_BONES[p.b];
               const p1 = pLms[bone.p[0]];
               const p2 = pLms[bone.p[1]];
               
               if (!p1 || !p2 || p1.visibility < 0.2 || p2.visibility < 0.2) {
                   p.active = false;
                   p.hist = []; // Clear history immediately to prevent ghost trails
                   return;
               }
               p.active = true;
               
               const p1x = p1.x * W; const p1y = p1.y * H;
               const p2x = p2.x * W; const p2y = p2.y * H;
               
               const dx = p2x - p1x; const dy = p2y - p1y;
               // Bump base thickness outwards slightly so trails clearly trace the exact camera contour 
               // instead of clipping under the segmentation mask
               const baseThickness = bone.w * refScale * W * 0.23;
               // Minimal spread so particles sit tightly right on the exterior edges
               const auraSpread = refScale * W * 0.15; 
               
               // Soft taper at bone ends
               const taper = Math.sin(p.t * Math.PI);
               const actualThickness = baseThickness * (0.6 + 0.4 * taper);
               
               const normalizedDist = p.randDist !== undefined ? p.randDist : Math.random();
               // Concentrate particles immediately outside the skin with a hard exponential dropoff
               const distFromSkin = Math.pow(normalizedDist, 2.5) * auraSpread;
               
               const rRadius = actualThickness + distFromSkin;
               
               let tx = p1x + dx * p.t + Math.cos(p.ang) * rRadius;
               let ty = p1y + dy * p.t + Math.sin(p.ang) * rRadius;
               
               // Movement Delta calculation for Dynamic Trailing
               const distToTarget = Math.hypot(tx - p.x, ty - p.y);
               
               // Safe, ultra-smooth fast tracking
               // Highly responsive interpolation for glued-on real-time sync without lag
               p.x += (tx - p.x) * 0.85;
               p.y += (ty - p.y) * 0.85;
               
               // Perfect radial "Iron Filings" orientation (No artificial wind swaying)
               const targetAngle = p.ang;
               
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
               const baseStickLen = refScale * W * 0.015 + (1.0 - normalizedDist) * refScale * W * 0.02; 
               const stickLen = baseStickLen * (0.4 + 0.6 * pulse); // Scintillate
               
               p.stickLen = stickLen;
               
               if (!p.hist) p.hist = [];
               
               // If the user actively moves, draw trailing comets. Otherwise, shrink back to iron filings.
               if (distToTarget > W * 0.003) {
                   p.hist.push({x: p.x, y: p.y, angle: p.angle, len: stickLen});
                   if (p.hist.length > 3) p.hist.shift();
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
                            if (Math.hypot(p.hist[j].x - p.hist[j-1].x, p.hist[j].y - p.hist[j-1].y) > 50) {
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
                // Sharper, highly-creative fiery plasma palette (No murky over-blooming)
                // Wide ambient heat
                drawTrails(10.0, 'rgba(255, 75, 10, 0.05)');
                
                // Tight energetic amber structure
                drawTrails(2.5, 'rgba(255, 150, 20, 0.35)');
                
                // Razor-fine white-hot filament tips
                drawTrails(0.8, 'rgba(255, 255, 255, 0.9)');
            }
            
            // To strictly ensure NO THREADS overlap the user
            if (results.segmentationMask && maskCanvasRef.current) {
                const mCanvas = maskCanvasRef.current;
                mCanvas.width = W; 
                mCanvas.height = H;
                const mCtx = mCanvas.getContext('2d');
                if (mCtx) {
                    mCtx.clearRect(0, 0, W, H);
                    mCtx.drawImage(results.segmentationMask, 0, 0, W, H);
                    
                    mCtx.globalCompositeOperation = 'source-in';
                    if (showCameraRef.current) {
                        // User in full actual color, contrasting with the black/white background
                        mCtx.drawImage(results.image, 0, 0, W, H);
                    } else {
                        mCtx.fillStyle = '#0f0f11';
                        mCtx.fillRect(0, 0, W, H);
                    }
                    mCtx.globalCompositeOperation = 'source-over';
                    
                    canvasCtx.drawImage(mCanvas, 0, 0, W, H);
                }
            }
        }
      canvasCtx.restore();
      return;
    }
    
    // Draw Pose
    if (results.poseLandmarks && drawConnectors && drawLandmarks && POSE_CONNECTIONS) {
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
    if (results.faceLandmarks && drawConnectors && FACEMESH_TESSELATION) {
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
    if (results.leftHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
      drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS,
                     {color: 'rgba(255, 255, 255, 0.6)', lineWidth: 1.5});
      drawLandmarks(canvasCtx, results.leftHandLandmarks,
                    {color: 'rgba(255, 255, 255, 1)', fillColor: '#000000', lineWidth: 1, radius: 2});
    }

    // Draw Right Hand
    if (results.rightHandLandmarks && drawConnectors && drawLandmarks && HAND_CONNECTIONS) {
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
        muted 
      />

      {/* Main Canvas */}
      <div className="absolute inset-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="w-full h-full object-cover opacity-90"
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
              <h2 className="text-xs tracking-[0.25em] uppercase text-white/50 mb-6">Camera Required</h2>
              <button 
                onClick={initMediaPipe}
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3 border border-white/20 text-white text-xs tracking-[0.2em] uppercase hover:border-white/50 hover:bg-white/5 transition-all duration-200"
              >
                <Play className="w-3 h-3 fill-white" />
                Start
              </button>
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
          </div>

          {/* Bottom Right: Signature */}
          <div className="text-right">
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
