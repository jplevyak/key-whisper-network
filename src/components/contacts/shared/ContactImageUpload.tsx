
import React from 'react';
import { Button } from '@/components/ui/button';
import { Image, Camera } from 'lucide-react';
import ImageCapture from '../ImageCapture';

interface ContactImageUploadProps {
  currentImage: string;
  onImageCapture: (image: string) => void;
}

const ContactImageUpload = ({ currentImage, onImageCapture }: ContactImageUploadProps) => {
  // Check if the current image is the placeholder or a captured image
  const isPlaceholder = currentImage.includes('placeholder.svg');

  const handleClearImage = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event from bubbling up
    onImageCapture('');
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative">
        <img
          src={currentImage}
          alt="Contact"
          className="w-20 h-20 rounded-full object-cover"
        />
        {!isPlaceholder && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute bottom-0 right-0"
            onClick={handleClearImage}
          >
            <Image className="h-4 w-4" />
          </Button>
        )}
      </div>
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
