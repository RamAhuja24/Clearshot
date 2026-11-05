import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FILE_INPUT_ACCEPT } from '../features/uploads/fileValidation';
import { cx } from '../lib/cx';
import { Button } from './Button';
import styles from './Dropzone.module.css';
import { Icon } from './Icon';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
}

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

export function Dropzone({ onFiles }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave also fire for child elements, so count nesting depth.
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;

  // A file dropped just outside the zone would otherwise make the browser open it.
  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventNavigation);
    window.addEventListener('drop', preventNavigation);
    return () => {
      window.removeEventListener('dragover', preventNavigation);
      window.removeEventListener('drop', preventNavigation);
    };
  }, []);

  return (
    <div
      className={cx(styles.zone, isDragging && styles.dragging)}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={(event) => {
        event.preventDefault();
        setDragDepth(0);
        onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className={styles.icon}>
        <Icon name="upload" size={26} />
      </div>
      <p className={styles.title}>
        {isDragging ? 'Drop to upload' : 'Drag and drop your photos here'}
      </p>
      <p className={styles.hint}>JPG, PNG or HEIC · up to 25 MB each · add as many as you like</p>
      <Button className={styles.browse} onClick={() => inputRef.current?.click()}>
        Browse files
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Choose photos to upload"
        data-testid="file-input"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = ''; // allow choosing the same file again
        }}
      />
    </div>
  );
}
