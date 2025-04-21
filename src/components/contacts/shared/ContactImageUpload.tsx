
import React from 'react';
import { Button } from '@/components/ui/button';
import { Image } from 'lucide-react';
import ImageCapture from '../ImageCapture';

interface ContactImageUploadProps {
  currentImage: string;
  onImageCapture: (image: string) => void;
}

const ContactImageUpload = ({ currentImage, onImageCapture }: ContactImageUploadProps) => {
  return (
    <div className="flex items-center space-x-4">
      <div className="relative">
        <img
          src={currentImage}
          alt="Contact"
          className="w-20 h-20 rounded-full object-cover"
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute bottom-0 right-0"
          onClick={() => onImageCapture('')}
        >
          <Image className="h-4 w-4" />
        </Button>
      </div>
      <ImageCapture
        onImageCapture={onImageCapture}
        capturedImage={currentImage}
      />
    </div>
  );
};

export default ContactImageUpload;
