# 스왑 2GB(2GB 서버 필수)
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-safe-school.conf && sudo sysctl --system
free -m   # Swap 2047 확인
```
- 스왑은 빌드·순간 증가를 넘기기 위한 안전망입니다. 평소 스왑 사용량이 계속 늘면 4GB로 올립니다(`step7-2gb-memory.md`).
