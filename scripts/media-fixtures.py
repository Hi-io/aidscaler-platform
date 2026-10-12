"""Synthetic byte fixtures for decoder integration, not a disaster accuracy corpus."""
from pathlib import Path
from PIL import Image,ImageDraw
import av
folder=Path('.local/media-fixtures');folder.mkdir(parents=True,exist_ok=True)
im=Image.new('RGB',(640,360),'#edf0f8');d=ImageDraw.Draw(im)
d.rectangle((40,40,600,84),fill='#162237');d.text((65,52),'TEST FIXTURE - WATER STORAGE',fill='white')
for x in (80,200,320):
    d.rounded_rectangle((x,130,x+70,260),radius=18,fill='#587cb5');d.text((x+17,184),'WATER',fill='white')
d.text((75,310),'Three containers. Volume is NOT specified.',fill='#172332')
im.save(folder/'water-storage.png')
im.save(folder/'field-note.pdf','PDF',resolution=100)
container=av.open(str(folder/'access.mp4'),mode='w');stream=container.add_stream('mpeg4',rate=5);stream.width=640;stream.height=360;stream.pix_fmt='yuv420p'
for i in range(25):
    frame=im.copy();draw=ImageDraw.Draw(frame)
    draw.rectangle((500,180,550,230),fill='#cc705e' if i>10 else '#587cb5')
    for packet in stream.encode(av.VideoFrame.from_image(frame)):container.mux(packet)
for packet in stream.encode():container.mux(packet)
container.close()
print('Synthetic image, PDF and five-second video fixtures created.')
