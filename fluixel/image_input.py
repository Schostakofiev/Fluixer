"""Local U2-Net foreground extraction; network-free at inference time."""
import base64
import io
import sys
import threading
from pathlib import Path

_session = None
_lock = threading.Lock()

def photo_subject(source):
    global _session
    if not isinstance(source,str) or len(source)>3500000:
        raise ValueError('Image data is too large')
    try: raw=base64.b64decode(source,validate=True)
    except (ValueError,TypeError) as exc: raise ValueError('Invalid image data') from exc
    runtime=Path(__file__).resolve().parents[1]/'vendor'/'image-runtime'
    if str(runtime) not in sys.path:sys.path.insert(0,str(runtime))
    try:
        import numpy as np
        import onnxruntime as ort
        from PIL import Image,ImageOps,UnidentifiedImageError
    except ImportError as exc:raise ValueError('Photo recognition dependencies are missing. Reinstall the image package') from exc
    try:
        img=Image.open(io.BytesIO(raw))
        if img.format not in ('PNG','JPEG','WEBP') or img.width*img.height>24000000:
            raise ValueError('Only PNG, JPEG and WebP are supported, up to 24 megapixels')
        img=ImageOps.exif_transpose(img).convert('RGBA');img.thumbnail((1024,1024))
    except (UnidentifiedImageError,OSError,Image.DecompressionBombError) as exc:
        raise ValueError('Could not read the image') from exc
    model=runtime.parent/'models'/'u2netp.onnx'
    if not model.is_file():raise ValueError('Subject extraction model is missing. Reinstall the image package')
    with _lock:
        if _session is None:
            options=ort.SessionOptions();options.intra_op_num_threads=2
            _session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
        rgb=Image.new('RGB',img.size,'white');rgb.paste(img,mask=img.getchannel('A'))
        pixels=np.asarray(rgb.resize((320,320),Image.Resampling.LANCZOS),dtype=np.float32)
        pixels=pixels/max(float(pixels.max()),1e-6)
        pixels=(pixels-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
        pred=_session.run(None,{_session.get_inputs()[0].name:pixels.transpose(2,0,1)[None]})[0][0,0]
        low,high=float(pred.min()),float(pred.max())
        if high-low<1e-6:raise ValueError('No clear subject detected. Try graphic extraction mode')
        mask=Image.fromarray(((pred-low)/(high-low)*255).astype('uint8')).resize(img.size,Image.Resampling.LANCZOS)
        alpha=np.minimum(np.asarray(mask),np.asarray(img.getchannel('A')))
        img.putalpha(Image.fromarray(alpha))
    out=io.BytesIO();img.save(out,format='PNG')
    return {'png':base64.b64encode(out.getvalue()).decode('ascii')}
