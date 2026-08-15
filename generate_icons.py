import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Base dark slate background
    img = Image.new("RGBA", (size, size), (11, 15, 25, 255))
    draw = ImageDraw.Draw(img)
    
    # Outer circle representing connection/monitoring
    margin = size * 0.08
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(18, 25, 41, 255),
        outline=(0, 242, 195, 100),
        width=max(1, int(size * 0.02))
    )
    
    # Draw a inner glowing circular highlight
    inner_margin = size * 0.12
    draw.ellipse(
        [inner_margin, inner_margin, size - inner_margin, size - inner_margin],
        fill=None,
        outline=(0, 242, 195, 40),
        width=max(1, int(size * 0.01))
    )

    # Core chip bounds
    cw = size * 0.32
    ch = size * 0.32
    cx = size / 2
    cy = size / 2
    
    # Draw glossy CPU core body
    draw.rounded_rectangle(
        [cx - cw/2, cy - ch/2, cx + cw/2, cy + ch/2],
        radius=max(4, int(size * 0.04)),
        fill=(0, 242, 195, 30),
        outline=(0, 242, 195, 255),
        width=max(1, int(size * 0.024))
    )
    
    # Draw CPU contacts/pins
    pin_len = size * 0.08
    pin_w = max(1, int(size * 0.02))
    offsets = [-size * 0.09, 0, size * 0.09]
    
    for offset in offsets:
        # Top pins
        draw.line([cx + offset, cy - ch/2, cx + offset, cy - ch/2 - pin_len], fill=(0, 242, 195, 255), width=pin_w)
        # Bottom pins
        draw.line([cx + offset, cy + ch/2, cx + offset, cy + ch/2 + pin_len], fill=(0, 242, 195, 255), width=pin_w)
        # Left pins
        draw.line([cx - cw/2, cy + offset, cx - cw/2 - pin_len, cy + offset], fill=(0, 242, 195, 255), width=pin_w)
        # Right pins
        draw.line([cx + cw/2, cy + offset, cx + cw/2 + pin_len, cy + offset], fill=(0, 242, 195, 255), width=pin_w)
        
    return img

if __name__ == '__main__':
    os.makedirs('public/icons', exist_ok=True)
    
    print("Generating icons...")
    icon192 = create_icon(192)
    icon192.save('public/icons/icon-192.png')
    
    icon512 = create_icon(512)
    icon512.save('public/icons/icon-512.png')
    
    print("PWA Launcher Icons generated successfully at public/icons/!")
