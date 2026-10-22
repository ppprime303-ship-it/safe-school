# (STEP 3-D 서식 분석용) 학교 HWP 문서의 본문·표 칸·첫 쪽 미리보기를 추출합니다. 결과물에 개인정보가 있을 수 있으니 저장소에 커밋하지 마세요.
# HWP5(OLE) 읽기: 표준 라이브러리만 사용. 사용: python3 -I hwp5read.py <file.hwp> <outdir>
import struct, sys, zlib, os
def ole(path):
    d=open(path,"rb").read()
    assert d[:8]==bytes.fromhex("D0CF11E0A1B11AE1"), "OLE 아님"
    ss=1<<struct.unpack_from("<H",d,30)[0]; mss=1<<struct.unpack_from("<H",d,32)[0]
    nfat,dirstart,_,minicut,minifat,nminifat,difat,ndifat=struct.unpack_from("<IIIIIIII",d,44)
    sec=lambda i: d[512+i*ss:512+(i+1)*ss]
    fatsecs=list(struct.unpack_from("<109I",d,76))
    nx=difat
    while nx not in (0xFFFFFFFE,0xFFFFFFFF) and ndifat:
        s=sec(nx); fatsecs+=list(struct.unpack_from("<%dI"%(ss//4-1),s)); nx=struct.unpack_from("<I",s,ss-4)[0]; ndifat-=1
    fat=[]
    for f in fatsecs[:nfat]: fat+=struct.unpack("<%dI"%(ss//4),sec(f))
    def chain(st):
        out=[];
        while st<0xFFFFFFFA and len(out)<10**6: out.append(st); st=fat[st]
        return out
    rd=lambda st: b"".join(sec(i) for i in chain(st))
    dirs=rd(dirstart); ents=[]
    for i in range(len(dirs)//128):
        e=dirs[i*128:(i+1)*128]; nl=struct.unpack_from("<H",e,64)[0]
        name=e[:max(nl-2,0)].decode("utf-16le",errors="ignore"); typ=e[66]
        l,r,c=struct.unpack_from("<III",e,68); st,size=struct.unpack_from("<II",e,116)
        ents.append(dict(name=name,type=typ,left=l,right=r,child=c,start=st,size=size))
    root=ents[0]; ministream=rd(root["start"]); mfat=[]
    for i in chain(minifat): mfat+=struct.unpack("<%dI"%(ss//4),sec(i))
    def mrd(st,size):
        out=b""
        while st<0xFFFFFFFA and len(out)<size: out+=ministream[st*mss:(st+1)*mss]; st=mfat[st]
        return out[:size]
    # 경로 만들기
    paths={}
    def walk(i,prefix):
        if i==0xFFFFFFFF or i>=len(ents): return
        e=ents[i]; walk(e["left"],prefix); p=prefix+e["name"]; paths[p]=e
        if e["type"]==1: walk(e["child"],p+"/")
        walk(e["right"],prefix)
    walk(root["child"],"")
    def get(p):
        e=paths[p]; return mrd(e["start"],e["size"]) if e["size"]<minicut else rd(e["start"])[:e["size"]]
    return paths,get
def records(b):
    i=0
    while i+4<=len(b):
        h=struct.unpack_from("<I",b,i)[0]; tag=h&0x3FF; lvl=(h>>10)&0x3FF; size=h>>20; i+=4
        if size==0xFFF: size=struct.unpack_from("<I",b,i)[0]; i+=4
        yield tag,lvl,b[i:i+size]; i+=size
def para_text(data):
    s=[];i=0;n=len(data)//2
    while i<n:
        c=struct.unpack_from("<H",data,i*2)[0]
        if c in (1,2,3,11,12,14,15,16,17,18,21,22,23): i+=8; s.append({11:"",2:"",3:""}.get(c,"")) ; continue
        if c in (4,5,6,7,8,19,20): i+=8; continue
        if c==9: s.append("\t")
        elif c==10: s.append("\n")
        elif c==13: pass
        elif c==24: s.append("-")
        elif c>=32: s.append(chr(c))
        i+=1
    return "".join(s)
if __name__=="__main__":
    path,out=sys.argv[1],sys.argv[2]; os.makedirs(out,exist_ok=True)
    paths,get=ole(path)
    print("streams:",[p for p in paths])
    hdr=get("FileHeader"); comp=struct.unpack_from("<I",hdr,36)[0]&1
    if "PrvText" in paths: open(f"{out}/PrvText.txt","w").write(get("PrvText").decode("utf-16le",errors="ignore"))
    if "PrvImage" in paths:
        b=get("PrvImage"); ext="png" if b[:4]==b"\x89PNG" else ("gif" if b[:3]==b"GIF" else "bin"); open(f"{out}/PrvImage.{ext}","wb").write(b)
    lines=[]
    secs=sorted([p for p in paths if p.startswith("BodyText/Section")],key=lambda x:int(x.split("Section")[1]))
    for sp in secs:
        raw=get(sp); body=zlib.decompress(raw,-15) if comp else raw
        for tag,lvl,data in records(body):
            if tag==71 and len(data)>=4:  # CTRL_HEADER
                cid=data[:4][::-1].decode("latin1",errors="ignore")
                if cid=="tbl ": lines.append(f"{'  '*lvl}[표 시작]")
            elif tag==72: lines.append(f"{'  '*lvl}[칸]")
            elif tag==67:
                t=para_text(data)
                if t.strip(): lines.append(f"{'  '*lvl}{t}")
    open(f"{out}/text.txt","w").write("\n".join(lines))
    # BinData(사진) 개수
    print("bindata:",len([p for p in paths if p.startswith("BinData/")]),"compressed:",comp)
