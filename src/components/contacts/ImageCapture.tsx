import React, { useEffect, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import CameraDeviceSelector from "./CameraDeviceSelector";
import { Button } from "@/components/ui/button";

interface ImageCaptureProps {
  onImageCapture: (image: string) => void;
  capturedImage: string;
}

const ImageCapture = ({ onImageCapture, capturedImage }: ImageCaptureProps) => {
  // Create a local state to immediately show the captured image
  const [localImage, setLocalImage] = useState<string>(capturedImage);

  // Update local image when capturedImage changes (for initial load and external updates)
  useEffect(() => {
    setLocalImage(capturedImage);
  }, [capturedImage]);

  const {
    isCameraActive,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    captureImage,
    showDeviceSelector,
    setShowDeviceSelector,
    devices,
    handleDeviceSelect,
  } = useCamera();

  // Check if the image is a placeholder
  const isPlaceholder = !localImage || localImage.includes("placeholder.svg");

  // Clean up camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // When the user clicks on the camera area with no image
  const handlePlaceholderClick = () => {
    if (isPlaceholder && !isCameraActive) {
      startCamera();
    }
  };

  const handleCaptureClick = () => {
    if (isCameraActive) {
      const image = captureImage();
      if (image) {
        // Update local state immediately for UI refresh
        setLocalImage(image);
        // Pass up to parent component for storage
        onImageCapture(image);
        stopCamera();
      }
    } else {
      startCamera();
    }
  };

  const handleRetakeClick = () => {
    // Directly start the camera. The existing image remains until a new one is captured.
    startCamera();
  };

  return (
    <div className="space-y-2">
      <div
        className="relative aspect-square max-w-[200px] mx-auto overflow-hidden rounded-full border border-border bg-muted/50 cursor-pointer group"
        onClick={
          isPlaceholder && !isCameraActive ? handlePlaceholderClick : undefined
        }
      >
        {isCameraActive ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : !isPlaceholder ? (
          <img
            src={localImage}
            alt="Contact"
            className="w-full h-full object-cover"
          />
        ) : (
          // Placeholder view (e.g., initial state or when image cleared)
          // Uses videoRef so camera can start here if handlePlaceholderClick is used
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover" // Will be blank or show placeholder styling
          />
        )}
        {!isCameraActive && ( // Only show overlay icons if camera is not active
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isPlaceholder ? (
              <CameraOff className="w-8 h-8 text-white" /> // Icon for "has image, retake?"
            ) : (
              <Camera className="w-8 h-8 text-white" /> // Icon for "no image, open camera?"
            )}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive ? (
        <Button
          variant="outline"
          type="button"
          className="w-full mt-2"
          onClick={handleCaptureClick}
        >
          Take Photo
        </Button>
      ) : !isPlaceholder ? (
        <Button
          variant="outline"
          type="button"
          className="w-full mt-2"
          onClick={handleRetakeClick}
        >
          Retake Photo
        </Button>
      ) : (
        <Button
          variant="outline"
          type="button"
          className="w-full mt-2"
          onClick={() => startCamera()}
        >
          Open Camera
        </Button>
      )}

      <CameraDeviceSelector
        devices={devices}
        onDeviceSelect={handleDeviceSelect}
        onClose={() => setShowDeviceSelector(false)}
        isOpen={showDeviceSelector}
      />
    </div>
  );
};

export default ImageCapture;
