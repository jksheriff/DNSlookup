import socket
# socket is a networking tool
domain = input("enter domain: ")
try:
  ip_address = socket.gethostbyname(domain)
  print(ip_address)
except socket.gaierror:

  print("Domain could not be resolved.")
