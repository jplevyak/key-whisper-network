
import React from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import CameraDeviceSelector from './CameraDeviceSelector';
import { Button } from '@/components/ui/button';

interface ImageCaptureProps {
  onImageCapture: (image: string) => void;
  capturedImage: string;
}

const ImageCapture = ({ onImageCapture, capturedImage }: ImageCaptureProps) => {
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
    handleDeviceSelect
  } = useCamera();

  const handleCaptureOrRetake = () => {
    if (!isCameraActive) {
      startCamera();
    } else if (capturedImage && capturedImage !== '/placeholder.svg') {
      onImageCapture('');
      startCamera();
    } else {
      const image = captureImage();
      if (image) {
        onImageCapture(image);
        stopCamera();
      }
    }
  };

  // Check if the image is a placeholder
  const isPlaceholder = capturedImage.includes('placeholder.svg');

  return (
    <div className="space-y-2">
      <div 
        className="relative aspect-square max-w-[200px] mx-auto overflow-hidden rounded-full border border-border bg-muted/50 cursor-pointer group"
        onClick={handleCaptureOrRetake}
      >
        {capturedImage && !isPlaceholder ? (
          <img 
            src={capturedImage} 
            alt="Contact" 
            className="w-full h-full object-cover"
          />
        ) : (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
          {capturedImage && !isPlaceholder ? (
            <CameraOff className="w-8 h-8 text-white" />
          ) : (
            <Camera className="w-8 h-8 text-white" />
          )}
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
      
      <Button 
        variant="outline" 
        type="button" 
        className="w-full mt-2"
        onClick={handleCaptureOrRetake}
      >
        {isCameraActive ? "Take Photo" : (capturedImage && !isPlaceholder) ? "Retake Photo" : "Open Camera"}
      </Button>
      
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
