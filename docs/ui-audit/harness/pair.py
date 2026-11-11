import sys
from PIL import Image,ImageDraw,ImageFont
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',int(sys.argv[2]) if len(sys.argv)>2 else 40)
def pair(a,b,out):
    A=[Image.open(x) for x in a];B=[Image.open(x) for x in b];w=A[0].width;h=A[0].height
    o=Image.new('RGB',(w*len(A)*2+60*len(A),h+90),(236,239,243));d=ImageDraw.Draw(o);x=20
    for i in range(len(A)):
        d.text((x,20),'ANTES',fill=(180,40,40),font=f);o.paste(A[i],(x,80));x+=w+20
        d.text((x,20),'DEPOIS (protótipo)',fill=(8,120,111),font=f);o.paste(B[i],(x,80));x+=w+40
    o.save(out);print(out,o.size)
args=sys.argv[1].split(';');n=len(args)//2
pair(args[:n],args[n:],sys.argv[3])
