'use client';

import { useState, useRef } from 'react';
import { UploadIcon, Loader2Icon } from 'lucide-react';
import type { BoardItem } from '../../../lib/boardsApi';
import { getAssetDownloadUrl, uploadAsset } from '../../../lib/boardsApi';

interface ImageItemProps {
  item: BoardItem;
  projectId?: string;
  onUpdate?: (itemId: string, updates: { payload?: Record<string, any> }) => Promise<any>;
}

export function ImageItem({ item, projectId, onUpdate }: ImageItemProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assetId = item.payload.asset_id;
  const altText = item.payload.alt_text || 'Image';
  const caption = item.payload.caption;
  const fit = item.payload.fit || 'contain';

  const handleFileSelect = async (file: File) => {
    if (!projectId || !onUpdate) {
      console.error('projectId or onUpdate not provided');
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size must be less than 10MB');
      return;
    }

    try {
      setUploading(true);
      const result = await uploadAsset(item.id, file, projectId);
      
      // Update item payload with new asset_id
      await onUpdate(item.id, {
        payload: {
          ...item.payload,
          asset_id: result.asset_id,
          file_name: result.file_name,
          mime_type: result.mime_type,
        }
      });
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  if (!assetId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className={`flex-1 flex items-center justify-center border border-dashed rounded-lg text-muted-foreground cursor-pointer transition-colors
            ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-border hover:border-border/60 hover:bg-muted/50'}
            ${uploading ? 'pointer-events-none opacity-50' : ''}
          `}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />
          
          <div className="text-center p-6">
            {uploading ? (
              <>
                <Loader2Icon className="w-8 h-8 mx-auto mb-2 animate-spin text-blue-500" />
                <p className="text-xs">Uploading...</p>
              </>
            ) : (
              <>
                <UploadIcon className="w-8 h-8 mx-auto mb-2" />
                <p className="text-xs font-medium mb-0.5">Click to upload or drag and drop</p>
                <p className="text-[10px] text-muted-foreground/60">PNG, JPG, GIF up to 10MB</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const imageUrl = getAssetDownloadUrl(assetId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 relative rounded-lg overflow-hidden border border-border group">
        <img
          src={imageUrl}
          alt={altText}
          className={`w-full h-full ${
            fit === 'cover' ? 'object-cover' :
            fit === 'fill' ? 'object-fill' :
            'object-contain'
          }`}
        />
        
        {/* Change image button */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={handleClick}
            disabled={uploading}
            className="px-4 py-2 bg-white text-black rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <Loader2Icon className="w-4 h-4 animate-spin" />
                Uploading...
              </span>
            ) : (
              'Change Image'
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      </div>
      
      {caption && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {caption}
        </p>
      )}
    </div>
  );
}

