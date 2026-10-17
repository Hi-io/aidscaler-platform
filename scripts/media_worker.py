"""Local ASR, PDF and video decoding; stdout contains JSON only, never credentials."""
import json, os, sys, time
os.environ.setdefault('OMP_NUM_THREADS', '2')
request=json.load(sys.stdin)
started=time.perf_counter()
mode=request['mode']
if mode=='audio':
    from faster_whisper import WhisperModel
    model=WhisperModel(os.environ.get('ASR_MODEL','tiny'),device='cpu',compute_type='int8',cpu_threads=2,download_root=os.environ.get('ASR_CACHE','.local/models'))
    segments,info=model.transcribe(request['path'],beam_size=3,vad_filter=True,language=request.get('language'))
    rows=[{'start':s.start,'end':s.end,'text':s.text.strip(),'avgLogProbability':s.avg_logprob,'noSpeechProbability':s.no_speech_prob} for s in segments]
    result={'text':' '.join(s['text'] for s in rows),'segments':rows,'language':info.language,'languageProbability':info.language_probability,'durationSeconds':info.duration,'engine':'faster-whisper','model':os.environ.get('ASR_MODEL','tiny')}
elif mode=='pdf':
    from pypdf import PdfReader
    reader=PdfReader(request['path'])
    selected=request.get('pages') or list(range(1,min(len(reader.pages),20)+1))
    if len(selected)>20 or any(not isinstance(n,int) or n<1 or n>len(reader.pages) for n in selected):raise ValueError('Invalid bounded source page selection')
    pages=[{'page':n,'text':(reader.pages[n-1].extract_text() or '')[:20000],'textProvenance':'embedded_pdf_text'} for n in selected]
    scanned=[p for p in pages if not p['text'].strip()]
    if scanned:
        import pypdfium2 as pdfium
        from pathlib import Path
        destination=Path(request['output']);destination.mkdir(parents=True,exist_ok=True)
        document=pdfium.PdfDocument(request['path'])
        # Bounded image context. Unobserved pages remain pending, never fabricated.
        for p in scanned[:4]:
            page=document[p['page']-1]
            scale=min(1.5,1280/max(page.get_size()))
            bitmap=page.render(scale=scale);image=bitmap.to_pil()
            filename=destination/f"page-{p['page']:02d}.png";image.save(filename)
            p.update({'renderPath':str(filename),'ocrState':'pending_visual_transcription'})
            image.close();bitmap.close();page.close()
        document.close()
        for p in scanned[4:]:p['ocrState']='pending_context_limit'
    result={'pages':pages,'totalPageCount':len(reader.pages),'needsOCR':bool(scanned),'truncated':len(reader.pages)>len(pages),'unreadPageCount':max(0,len(reader.pages)-len(pages)),'engine':'pypdf','ocrScope':'at most four scanned pages rendered per batch; remaining pages can be requested explicitly; all transcriptions require review'}
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
