"use client";

import { useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImageCrop } from "@/lib/imageCrop";

interface Props {
  open: boolean;
  onClose: () => void;
  imageSrc: string;
  initialCrop: ImageCrop | null;
  onSave: (crop: ImageCrop) => void;
}

export function ImageCropDialog({ open, onClose, imageSrc, initialCrop, onSave }: Props) {
  const { t } = useLanguage();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(initialCrop ?? null);

  const handleSave = () => {
    if (croppedAreaPixels) onSave(croppedAreaPixels);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("crop_dialog_title")}</DialogTitle>
        </DialogHeader>

        <div className="relative w-full h-80 bg-muted/40 rounded overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            initialCroppedAreaPixels={initialCrop ?? undefined}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_area, areaPixels) => setCroppedAreaPixels(areaPixels)}
          />
        </div>

        <input
          type="range"
          min={1}
          max={5}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full accent-primary"
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
          <Button type="button" onClick={handleSave} disabled={!croppedAreaPixels}>{t("common_save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
