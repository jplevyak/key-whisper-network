import { useRef, useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export const useCamera = () => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string>("");
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>(
    [],
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  // Clean up camera resources when component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setIsCameraActive(false);
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      try {
        // Stop any existing stream first
        stopCamera(); // This sets isCameraActive(false) and clears videoRef.current.srcObject

        const constraints = {
          video: deviceId ? { deviceId } : { facingMode: "environment" },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream; // Store the stream
        setIsCameraActive(true); // Trigger re-render and useEffect
        setShowDeviceSelector(false);
      } catch (error) {
        // Attempt to fallback to device selection if initial attempt fails
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices
            .filter((device) => device.kind === "videoinput")
            .map((device) => ({
              deviceId: device.deviceId,
              label: device.label || `Camera ${device.deviceId.slice(0, 8)}...`,
            }));

          if (videoDevices.length === 0) {
            throw new Error("No camera devices found");
          }

          setDevices(videoDevices);
          setShowDeviceSelector(true);
        } catch (fallbackError) {
          console.error("Error accessing camera (fallback):", fallbackError);
          toast({
            title: "Camera Error",
            description:
              "Could not access your camera. Please check permissions.",
            variant: "destructive",
          });
        }
      }
    },
    [stopCamera, toast],
  );

  // Effect to manage attaching/detaching stream to video element
  useEffect(() => {
    if (videoRef.current) {
      if (isCameraActive && streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(err => {
          console.warn("Video play() failed, possibly due to autoplay policy:", err);
        });
      } else {
        // Ensure srcObject is cleared if camera is not active or no stream
        // stopCamera also handles this, but this is an additional safeguard
        if (videoRef.current.srcObject) {
          videoRef.current.srcObject = null;
        }
      }
    }
    // This effect should run when isCameraActive changes.
    // streamRef.current is updated before isCameraActive is set to true in startCamera.
    // videoRef.current is updated by React's render cycle triggered by isCameraActive change.
  }, [isCameraActive]);

  const captureImage = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return "";

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Make sure video is ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      return "";
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const handleDeviceSelect = useCallback(
    (deviceId: string) => {
      startCamera(deviceId);
    },
    [startCamera],
  );

  return {
    isCameraActive,
    capturedImage,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    captureImage,
    setCapturedImage,
    showDeviceSelector,
    setShowDeviceSelector,
    devices,
    handleDeviceSelect,
  };
};
