import socket
# socket is a networking tool
domain = input("enter domain: ")

ip_address = socket.gethostbyname(domain)
print(ip_address)
