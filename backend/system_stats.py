"""システムリソース情報（lm-chat / news-picker の /system/resources を移植）。

CPU / RAM は psutil、GPU / VRAM は pynvml。どちらも無ければ 0 を返す。
"""

from __future__ import annotations

from typing import Any

try:
    import psutil

    _PSUTIL = True
except ImportError:
    _PSUTIL = False

try:
    import pynvml as nvml

    nvml.nvmlInit()
    _NVML = True
except Exception:  # NVIDIA ドライバなし等
    _NVML = False


def get_resources() -> dict[str, Any]:
    cpu_percent = psutil.cpu_percent(interval=None) if _PSUTIL else 0
    vm = psutil.virtual_memory() if _PSUTIL else None

    gpus: list[dict[str, Any]] = []
    if _NVML:
        try:
            for i in range(nvml.nvmlDeviceGetCount()):
                handle = nvml.nvmlDeviceGetHandleByIndex(i)
                name = nvml.nvmlDeviceGetName(handle)
                util = nvml.nvmlDeviceGetUtilizationRates(handle)
                mem = nvml.nvmlDeviceGetMemoryInfo(handle)
                gpus.append(
                    {
                        "name": name if isinstance(name, str) else name.decode(),
                        "gpu_percent": util.gpu,
                        "vram_used_gb": round(mem.used / (1024**3), 2),
                        "vram_total_gb": round(mem.total / (1024**3), 2),
                        "vram_percent": round(mem.used / mem.total * 100, 1)
                        if mem.total
                        else 0,
                    }
                )
        except Exception:
            pass

    return {
        "cpu_percent": cpu_percent,
        "ram_used_gb": round(vm.used / (1024**3), 2) if vm else 0,
        "ram_total_gb": round(vm.total / (1024**3), 2) if vm else 0,
        "ram_percent": vm.percent if vm else 0,
        "gpus": gpus,
    }
