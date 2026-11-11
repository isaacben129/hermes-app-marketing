import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, MARGIN = 1080, 1350, 88
PALETTES = {
    'neutral': {'background':'#F7F5F0','ink':'#25302D','muted':'#64706C','accent':'#A04440','rule':'#E6E9E3'},
    'ink': {'background':'#26312E','ink':'#F7F5F0','muted':'#CFD5D0','accent':'#E2B477','rule':'#35413D'},
}

def _font(size, bold=False):
    name='DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    candidates = ['/usr/share/fonts/truetype/dejavu/'+name, name]
    try:
        from PIL import __file__ as pil_file
        candidates.append(str(Path(pil_file).parent / 'fonts' / name))
    except (ImportError, NameError):
        pass
    for candidate in candidates:
        try: return ImageFont.truetype(candidate,size)
        except OSError: pass
    raise RuntimeError('A bundled DejaVu Sans font is required for deterministic rendering.')

def _lines(draw,text,font,max_width):
    result=[]
    for para in str(text).splitlines() or ['']:
        line=''
        for word in para.split():
            candidate=(line+' '+word).strip()
            if draw.textbbox((0,0),candidate,font=font)[2] <= max_width:
                line=candidate; continue
            if line: result.append(line)
            if draw.textbbox((0,0),word,font=font)[2] <= max_width:
                line=word; continue
            part=''
            for char in word:
                if part and draw.textbbox((0,0),part+char,font=font)[2] > max_width:
                    result.append(part); part=char
                else: part += char
            line=part
        if line: result.append(line)
    return result

def _fit(draw,text,max_width,max_height,start,minimum,bold=False):
    for size in range(start,minimum-1,-2):
        font=_font(size,bold); lines=_lines(draw,text,font,max_width); line_height=int(size*1.3)
        if len(lines)*line_height <= max_height: return font,lines,line_height
    raise ValueError('Text does not fit at minimum readable font size; shorten the copy.')

def render_slideshow(payload):
    payload=payload or {}; slides=payload.get('slides')
    if not isinstance(slides,list) or not 1 <= len(slides) <= 20: raise ValueError('Provide 1–20 ordered slides.')
    theme=payload.get('theme','neutral')
    if theme not in PALETTES: raise ValueError(f'Unsupported theme: {theme}')
    palette=PALETTES[theme]; output=[]
    for i,item in enumerate(slides):
        if isinstance(item,str): item={'body':item}
        if not isinstance(item,dict): raise ValueError(f'Slide {i+1} must be text or an object.')
        title=str(item.get('title') or (payload.get('title','') if i==0 else '')).strip()
        body=str(item.get('body') or item.get('text') or '').strip()
        if not title and not body: raise ValueError(f'Slide {i+1} is empty.')
        image=Image.new('RGB',(WIDTH,HEIGHT),palette['background']); draw=ImageDraw.Draw(image)
        draw.rectangle((MARGIN,92,MARGIN+72,102),fill=palette['accent'])
        draw.text((MARGIN,132),f'SLIDE {i+1:02d}  /  {len(slides):02d}',font=_font(24),fill=palette['muted'])
        if title:
            font,lines,height=_fit(draw,title,WIDTH-2*MARGIN,390,72,40,True); y=260
            for line in lines: draw.text((MARGIN,y),line,font=font,fill=palette['ink']); y+=height
        if body:
            font,lines,height=_fit(draw,body,WIDTH-2*MARGIN,430,46,32,False); y=760 if title else 350
            for line in lines: draw.text((MARGIN,y),line,font=font,fill=palette['ink']); y+=height
        draw.rectangle((MARGIN,1184,WIDTH-MARGIN,1186),fill=palette['rule'])
        draw.text((MARGIN,1204),'ILLUSTRATIVE COPY · REVIEW BEFORE USE',font=_font(20),fill=palette['muted'])
        buf=io.BytesIO(); image.save(buf,format='PNG',optimize=True)
        output.append({'index':i+1,'width':WIDTH,'height':HEIGHT,'png':buf.getvalue()})
    return {'dimensions':{'width':WIDTH,'height':HEIGHT},'theme':theme,'slides':output}


def export_slideshow_zip(rendered, output_path, source=None):
    import json, zipfile
    from pathlib import Path
    output_path=Path(output_path)
    if not rendered.get('slides'): raise ValueError('Render slides before exporting.')
    manifest={'format':'APP Marketing local slideshow export','version':1,'dimensions':rendered['dimensions'],'theme':rendered['theme'],'source':source or {},'files':[]}
    with zipfile.ZipFile(output_path,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for slide in rendered['slides']:
            name=f"slide-{slide['index']:02d}.png"; archive.writestr(name,slide['png']); manifest['files'].append(name)
        archive.writestr('manifest.json',json.dumps(manifest,indent=2))
    return output_path
