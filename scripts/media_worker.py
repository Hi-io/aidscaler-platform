"""Local ASR, PDF and video decoding; stdout contains JSON only, never credentials."""
import json, os, sys, time
os.environ.setdefault('OMP_NUM_THREADS', '2')
request=json.load(sys.stdin)
started=time.perf_counter()
mode=request['mode']
if mode=='audio':
    from faster_whisper import WhisperModel
    model=WhisperModel(os.environ.get('ASR_MODEL','tiny'),device='cpu',compute_type='int8',cpu_threads=2,download_root='.local/models')
    segments,info=model.transcribe(request['path'],beam_size=3,vad_filter=True,language=request.get('language'))
    rows=[{'start':s.start,'end':s.end,'text':s.text.strip(),'avgLogProbability':s.avg_logprob,'noSpeechProbability':s.no_speech_prob} for s in segments]
    result={'text':' '.join(s['text'] for s in rows),'segments':rows,'language':info.language,'languageProbability':info.language_probability,'durationSeconds':info.duration,'engine':'faster-whisper','model':os.environ.get('ASR_MODEL','tiny')}
elif mode=='pdf':
    from pypdf import PdfReader
    reader=PdfReader(request['path']);pages=[{'page':i+1,'text':(p.extract_text() or '')[:20000]} for i,p in enumerate(reader.pages[:20])];result={'pages':pages,'needsOCR':any(not p['text'].strip() for p in pages),'truncated':len(reader.pages)>20,'engine':'pypdf'}
elif mode=='public_image':
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS=20000000
    with Image.open(request['path']) as original:
        image=ImageOps.exif_transpose(original).convert('RGB')
        image.thumbnail((1600,1600))
        # A newly encoded image strips EXIF, location and other original metadata.
        clean=Image.new('RGB',image.size);clean.paste(image)
        clean.save(request['output'],format='PNG')
        result={'width':clean.width,'height':clean.height,'engine':'pillow','metadataStripped':True,'peopleAutomaticallyDetected':False}
elif mode=='video':
    import av, pathlib
    destination=pathlib.Path(request['output']);destination.mkdir(parents=True,exist_ok=True)
    container=av.open(request['path']);stream=container.streams.video[0];duration=float(stream.duration*stream.time_base) if stream.duration else 0
    threshold=0;rows=[]
    for frame in container.decode(stream):
        at=float(frame.time or 0)
        if at<threshold:continue
        image=frame.to_image();image.thumbnail((1024,1024));name=destination/f'frame-{len(rows):02d}.png';image.save(name);rows.append({'path':str(name),'seconds':at});threshold=at+max(1,duration/6)
        if len(rows)>=6:break
    result={'frames':rows,'durationSeconds':duration,'engine':'pyav','sampling':'up to six sampled frames; not exhaustive video coverage'}
else:raise ValueError('Unsupported media processing mode')
result['wallMs']=(time.perf_counter()-started)*1000
print(json.dumps(result,ensure_ascii=False))
