import React, { useEffect, useRef, useState } from 'react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasBarcodeDetector, setHasBarcodeDetector] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let stream: MediaStream | null = null;
    let animFrame: number;
    let isDetecting = true;

    const startCamera = async () => {
      try {
        setCameraError(null);
        if ('BarcodeDetector' in window) {
          setHasBarcodeDetector(true);
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          if ('BarcodeDetector' in window) {
            // @ts-expect-error BarcodeDetector is a draft browser API
            const detector = new window.BarcodeDetector({
              formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
            });

            const scan = async () => {
              if (!isDetecting) return;
              if (
                videoRef.current &&
                videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
              ) {
                try {
                  const barcodes = await detector.detect(videoRef.current);
                  if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                    onDetected(barcodes[0].rawValue);
                    onClose();
                    return;
                  }
                } catch {
                  // ignore detection frame errors
                }
              }
              animFrame = requestAnimationFrame(scan);
            };
            animFrame = requestAnimationFrame(scan);
          }
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to access camera. You can type the barcode manually.';
        setCameraError(msg);
      }
    };

    startCamera();

    return () => {
      isDetecting = false;
      cancelAnimationFrame(animFrame);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, onDetected, onClose]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onDetected(manualInput.trim());
      onClose();
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} className="glass-panel">
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>📷</span>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Scan Product Barcode</h3>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ✕
          </button>
        </div>

        <div style={viewportContainerStyle}>
          {cameraError ? (
            <div style={errorContainerStyle}>
              <span style={{ fontSize: '2rem' }}>⚠️</span>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                {cameraError}
              </p>
            </div>
          ) : (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 260,
                overflow: 'hidden',
                borderRadius: 12,
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div style={targetBoxStyle}>
                <div style={laserLineStyle} />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <input
              type="text"
              autoFocus
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type/paste barcode (e.g. 089686010839)"
              style={inputStyle}
              className="mono"
            />
            <button
              type="submit"
              className="glow-btn"
              style={{ padding: '0 20px', borderRadius: 10 }}
            >
              Lookup
            </button>
          </form>

          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-dim)',
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {hasBarcodeDetector
              ? '✨ Real-time hardware barcode detection active'
              : 'Using video stream. Point camera directly at barcode or enter numbers manually.'}
          </p>
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(5, 8, 16, 0.85)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: '1.2rem',
  padding: 6,
  borderRadius: 8,
};

const viewportContainerStyle: React.CSSProperties = {
  padding: '20px 20px 0',
  position: 'relative',
};

const errorContainerStyle: React.CSSProperties = {
  height: 200,
  background: 'rgba(15, 23, 42, 0.6)',
  borderRadius: 12,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  border: '1px dashed var(--border-subtle)',
};

const targetBoxStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '75%',
  height: '55%',
  border: '2px solid rgba(16, 185, 129, 0.8)',
  borderRadius: 12,
  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const laserLineStyle: React.CSSProperties = {
  width: '90%',
  height: 2,
  background: '#10b981',
  boxShadow: '0 0 8px #10b981',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 14px',
  borderRadius: 10,
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
};
