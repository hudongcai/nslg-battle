param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'helper-app.ico')
)

Add-Type -AssemblyName System.Drawing

$csharp = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class HelperIconBuilder
{
    public static void SaveIcon(string outputPath)
    {
        using (var bitmap = new Bitmap(256, 256, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using (var bg = new LinearGradientBrush(
                new Rectangle(0, 0, 256, 256),
                Color.FromArgb(240, 180, 41),
                Color.FromArgb(61, 139, 255),
                45f))
            {
                g.FillEllipse(bg, 12, 12, 232, 232);
            }

            using (var ringPen = new Pen(Color.FromArgb(235, 246, 255), 12f))
            {
                g.DrawEllipse(ringPen, 18, 18, 220, 220);
            }

            using (var panel = new SolidBrush(Color.FromArgb(255, 255, 255)))
            {
                g.FillRoundedRectangle(panel, 64, 62, 128, 132, 26);
            }

            using (var accent = new SolidBrush(Color.FromArgb(240, 180, 41)))
            {
                g.FillRectangle(accent, 86, 92, 84, 20);
                g.FillRectangle(accent, 86, 122, 60, 18);
                g.FillRectangle(accent, 86, 150, 94, 18);
            }

            using (var lensPen = new Pen(Color.FromArgb(61, 139, 255), 16f))
            {
                g.DrawEllipse(lensPen, 146, 138, 42, 42);
                g.DrawLine(lensPen, 178, 170, 204, 196);
            }

            using (var pngStream = new MemoryStream())
            {
                bitmap.Save(pngStream, ImageFormat.Png);
                byte[] pngBytes = pngStream.ToArray();

                using (var fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
                using (var bw = new BinaryWriter(fs))
                {
                    bw.Write((ushort)0);
                    bw.Write((ushort)1);
                    bw.Write((ushort)1);
                    bw.Write((byte)0);
                    bw.Write((byte)0);
                    bw.Write((byte)0);
                    bw.Write((byte)0);
                    bw.Write((ushort)1);
                    bw.Write((ushort)32);
                    bw.Write(pngBytes.Length);
                    bw.Write(22);
                    bw.Write(pngBytes);
                }
            }
        }
    }
}

public static class GraphicsExtensions
{
    public static void FillRoundedRectangle(this Graphics g, Brush brush, int x, int y, int width, int height, int radius)
    {
        using (var path = new GraphicsPath())
        {
            int d = radius * 2;
            path.AddArc(x, y, d, d, 180, 90);
            path.AddArc(x + width - d, y, d, d, 270, 90);
            path.AddArc(x + width - d, y + height - d, d, d, 0, 90);
            path.AddArc(x, y + height - d, d, d, 90, 90);
            path.CloseFigure();
            g.FillPath(brush, path);
        }
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing
[HelperIconBuilder]::SaveIcon($OutputPath)
Write-Host "Created icon: $OutputPath"
