# NRRU Campus Map

แผนที่จุดตั้งถังขยะ มหาวิทยาลัยราชภัฏนครราชสีมา — เว็บไซต์ HTML/CSS/JavaScript แบบ static ไม่ต้อง build

## เปิดใช้งานในเครื่อง

```sh
python -m http.server 8765
```

เปิด http://localhost:8765 และทดสอบบนจอคอมพิวเตอร์และมือถือ

## แก้ไขข้อมูล

- `app.js`: รายการ `P` เก็บชื่อ คำอธิบาย และพิกัดหมุดเป็นเปอร์เซ็นต์ของภาพแผนผังเดิม
- `photoFiles`: รายชื่อไฟล์ภาพแต่ละจุดตามลำดับที่ต้องการให้แสดง เมื่อเพิ่มรูปใน `image/` ให้เพิ่มชื่อไฟล์ที่นี่ด้วย รองรับ JPEG, PNG และ WebP
- `style.css`: รูปแบบและ responsive layout
- `index.html`: โครงหน้าเว็บและหน้ารายละเอียด

ภาพแสดงด้วย `object-fit: contain` เพื่อคงภาพเต็มโดยไม่ตัดขอบ จุดที่มีหลายภาพจะเปลี่ยนภาพทุก 3 วินาที มีปุ่มก่อนหน้า/ถัดไป จุดเลือกภาพ ปัดซ้ายขวาบนจอสัมผัส ปุ่มลูกศรบนคีย์บอร์ด และปุ่มหยุด/เริ่มสไลด์ เมื่อปิดรายละเอียดหรือซ่อนแท็บ timer จะหยุดทำงาน การตั้งค่า reduced motion ของระบบจะเริ่มด้วยการหยุดสไลด์ และสามารถกดเริ่มเองได้

การโหลดภาพที่ผิดพลาดจะถูกข้าม และการเปิดสถานที่ใหม่จะไม่รับผลโหลดภาพที่ค้างจากสถานที่ก่อนหน้า

## ที่มาของตรามหาวิทยาลัย

ใช้ภาพตราที่เว็บไซต์มหาวิทยาลัยแสดง โดยเก็บไฟล์ไว้ในโครงการเพื่อไม่ต้องโหลดข้ามเว็บไซต์:

- เว็บไซต์: https://www.nrru.ac.th/
- ภาพต้นฉบับ: https://www.nrru.ac.th/theme/images/iconweb/logo_nrru.png
- ไฟล์: `image/nrru-logo.png` (ไม่แก้ไขรูปตรา)

## เผยแพร่

workflow เดิมใน `.github/workflows/pages.yml` เผยแพร่ GitHub Pages เมื่อมีการ push ไปยัง `main`

## เอฟเฟกต์ CSS / JavaScript (v1.1)

ใช้ React เฉพาะส่วนตกแต่งจาก React Bits: ClickSpark, CardSwap, ShapeBlur และ SplitText โดยปรับให้ทำงานร่วมกับเว็บไซต์ static เดิม

- ClickSpark: ประกาย 8 เส้นเมื่อคลิกปุ่ม (400ms), canvas วาดเฉพาะช่วงที่มีประกาย
- CardSwap: การ์ดภาพซ้อนและสลับด้วย GSAP โดยใช้ timer เดิม 3 วินาทีและยังคงภาพเต็ม
- ShapeBlur: shader จากตัวอย่างที่แนบมา โหลด Three.js แยกเฉพาะจอใหญ่ที่มีเมาส์ มีลาย CSS สำรองเมื่อไม่มี WebGL หยุดวาดเมื่ออยู่นอกจอ/ซ่อนแท็บ/เมาส์นิ่ง
- SplitText: ข้อความหัวเรื่องทยอยปรากฏโดยคงภาษาไทยและ screen-reader label
- รองรับ reduced motion; ส่วนแผนที่ ค้นหา และ gallery เดิมยังทำงานได้เมื่อ optional motion bundle โหลดไม่สำเร็จ

### Build

```sh
npm ci
npm run build
python -m http.server 8765
```

แก้เอฟเฟกต์ที่ `src/` แล้ว build ใหม่และ commit `assets/` ไปด้วย GitHub Pages จึงยังใช้ workflow static เดิมได้ โดยไม่ต้องตั้งค่า hosting ใหม่

### Browser verification

```sh
npx playwright install --with-deps chromium
node scripts/verify.mjs
```

workflow `Verify campus map` ตรวจบน Chromium เมื่อเปิด/อัปเดต PR พร้อม screenshots ขนาด desktop และ mobile สำหรับตรวจหน้าตา

ที่มาของเอฟเฟกต์: https://reactbits.dev/ และไฟล์ตัวอย่าง `promt.txt` ที่ผู้ใช้ให้มา รายละเอียดใน `THIRD_PARTY_NOTICES.md`

## กิจกรรมแยกขยะ

`activity.html` แสดงอันดับ 1–3, คะแนน, ของรางวัล, กติกา และแบบส่งรูปกิจกรรม ส่วน `admin.html` ใช้ตรวจรูปและตั้งวันหมดเขตตามเวลาไทย ระบบใช้ Supabase แยกจากแผนที่ และเปิดรับเฉพาะอีเมลมหาวิทยาลัยที่ยืนยันแล้ว

**สถานะ:** สร้างฐานข้อมูล Supabase แยกและกำหนดอีเมลแอดมินแล้ว แต่ `activity-config.js` ยังปิดการเข้าสู่ระบบไว้จนกว่าจะตั้งค่าผู้ให้บริการอีเมลและทดสอบยืนยันอีเมลจริง ดูขั้นตอนเปิดใช้งานและข้อจำกัดใน [supabase/SETUP.md](supabase/SETUP.md)
