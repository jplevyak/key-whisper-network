
import React from 'react';
import { Button } from '@/components/ui/button';
import { Image } from 'lucide-react';
import ImageCapture from '../ImageCapture';

interface ContactImageUploadProps {
  currentImage: string;
  onImageCapture: (image: string) => void;
}

const ContactImageUpload = ({ currentImage, onImageCapture }: ContactImageUploadProps) => {
  // Check if the current image is the placeholder or a captured image
  const isPlaceholder = !currentImage || currentImage.includes('placeholder.svg');

  const handleClearImage = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event from bubbling up
    onImageCapture('');
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="w-full max-w-xs">
        <ImageCapture
          onImageCapture={onImageCapture}
          capturedImage={currentImage}
        />
      </div>
    </div>
  );
};

export default ContactImageUpload;
